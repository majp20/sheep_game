import { ResizeSystem } from 'engine/systems/ResizeSystem.js';
import { UpdateSystem } from 'engine/systems/UpdateSystem.js';

import { GLTFLoader } from 'engine/loaders/GLTFLoader.js';
import { UnlitRenderer } from 'engine/renderers/UnlitRenderer.js';
import { FirstPersonController } from 'engine/controllers/FirstPersonController.js';

import { Camera, Model, Transform, Entity } from 'engine/core/core.js';

import {
    calculateAxisAlignedBoundingBox,
    mergeAxisAlignedBoundingBoxes,
} from 'engine/core/MeshUtils.js';

import { Physics } from './Physics.js';
import { loadSheep, setupSheepCollision } from './Sheep.js';

export async function startGame() {
    const canvas = document.querySelector('canvas');
    const renderer = new UnlitRenderer(canvas);
    await renderer.initialize();
    const loader = new GLTFLoader();
    await loader.load(new URL('./scene/gozd.gltf', import.meta.url));

    const scene = loader.loadScene();
    const camera = loader.loadNode('Camera');

    // Load sheep
    const sheepNodes = await loadSheep(scene);

    // Set player entity reference for all sheep (for flee behavior)
    for (const sheep of sheepNodes) {
        const sheepController = sheep.components?.find(c => c.constructor.name === 'SheepController');
        if (sheepController) {
            sheepController.playerEntity = camera;
        }
    }

    // Increase camera far clipping plane for better visibility
    const cameraComponent = camera.getComponentOfType(Camera);
    cameraComponent.far = 500; // Increase from default 100 to 500

    const controller = new FirstPersonController(camera, canvas, {
        acceleration: 90,
        maxSpeed: 13,
        pointerSensitivity: 0.001,
    });
    camera.addComponent(controller);
    
    // Raycast handler for launching sheep
    controller.onRaycast = (origin, rayEnd, direction) => {
        let closestSheep = null;
        let closestDistance = Infinity;
        let closestDistToCenter = Infinity;
        let bestAlignment = -Infinity;
        let hitCount = 0;
        
        // Calculate max distance from rayEnd
        const maxDistance = Math.sqrt(
            (rayEnd[0] - origin[0]) ** 2 +
            (rayEnd[1] - origin[1]) ** 2 +
            (rayEnd[2] - origin[2]) ** 2
        );
        
        // Check ray intersection with all sheep
        for (const sheep of sheepNodes) {
            const sheepTransform = sheep.getComponentOfType(Transform);
            if (!sheepTransform || !sheep.aabb) continue;
            
            // Ray-AABB intersection test
            const t = rayAABBIntersection(origin, direction, sheep.aabb, sheepTransform);
            if (t !== null && t <= maxDistance) {
                hitCount++;
                
                const sheepPos = sheepTransform.translation;
                
                // Calculate distance from ray to sheep center
                const rayPoint = [
                    origin[0] + direction[0] * Math.max(t, 0),
                    origin[1] + direction[1] * Math.max(t, 0),
                    origin[2] + direction[2] * Math.max(t, 0)
                ];
                
                const dx = rayPoint[0] - sheepPos[0];
                const dy = rayPoint[1] - sheepPos[1];
                const dz = rayPoint[2] - sheepPos[2];
                const distToCenter = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
                // Calculate alignment with look direction (dot product)
                const toSheep = [
                    sheepPos[0] - origin[0],
                    sheepPos[1] - origin[1],
                    sheepPos[2] - origin[2]
                ];
                const len = Math.sqrt(toSheep[0]**2 + toSheep[1]**2 + toSheep[2]**2);
                if (len > 0) {
                    toSheep[0] /= len;
                    toSheep[1] /= len;
                    toSheep[2] /= len;
                }
                const alignment = toSheep[0] * direction[0] + toSheep[1] * direction[1] + toSheep[2] * direction[2];
                
                // Pick sheep with best alignment to look direction (what you're aiming at)
                // Only consider sheep in front of camera (alignment > 0.5) to avoid hitting sheep behind
                if (alignment > 0.5 && alignment > bestAlignment) {
                    bestAlignment = alignment;
                    closestDistToCenter = distToCenter;
                    closestDistance = t;
                    closestSheep = sheep;
                }
            }
        }
        
        // Launch the closest sheep if found
        if (closestSheep) {
            // Try to find SheepController on this node
            let sheepController = closestSheep.components?.find(c => c.constructor.name === 'SheepController');
            
            // If not found, it might be a child mesh - search parent nodes
            if (!sheepController) {
                // Search all sheep nodes to find the one with a controller
                for (const sheep of sheepNodes) {
                    const controller = sheep.components?.find(c => c.constructor.name === 'SheepController');
                    if (controller) {
                        // Check if the hit node is this sheep or one of its children
                        const sheepTransform = sheep.getComponentOfType(Transform);
                        const hitTransform = closestSheep.getComponentOfType(Transform);
                        
                        // If positions are very close, it's the same sheep entity
                        if (hitTransform && sheepTransform) {
                            const dx = hitTransform.translation[0] - sheepTransform.translation[0];
                            const dy = hitTransform.translation[1] - sheepTransform.translation[1];
                            const dz = hitTransform.translation[2] - sheepTransform.translation[2];
                            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                            
                            if (dist < 0.1) { // Same position = same sheep
                                sheepController = controller;
                                break;
                            }
                        }
                    }
                }
            }
            
            if (sheepController) {
                // Launch sheep (allow re-launching if already launched)
                sheepController.launch(direction, 20);
            }
        }
    };
    
    // Ray-AABB intersection function
    function rayAABBIntersection(origin, direction, aabb, transform) {
        // Get the center and half-extents of AABB
        const center = [
            (aabb.min[0] + aabb.max[0]) / 2,
            (aabb.min[1] + aabb.max[1]) / 2,
            (aabb.min[2] + aabb.max[2]) / 2
        ];
        const halfExtents = [
            (aabb.max[0] - aabb.min[0]) / 2,
            (aabb.max[1] - aabb.min[1]) / 2,
            (aabb.max[2] - aabb.min[2]) / 2
        ];
        
        // Transform to world space (AABB center + entity position)
        const worldCenter = [
            center[0] + transform.translation[0],
            center[1] + transform.translation[1],
            center[2] + transform.translation[2]
        ];
        
        const worldMin = [
            worldCenter[0] - halfExtents[0],
            worldCenter[1] - halfExtents[1],
            worldCenter[2] - halfExtents[2]
        ];
        const worldMax = [
            worldCenter[0] + halfExtents[0],
            worldCenter[1] + halfExtents[1],
            worldCenter[2] + halfExtents[2]
        ];
        
        let tmin = 0;
        let tmax = Infinity;
        
        for (let i = 0; i < 3; i++) {
            if (Math.abs(direction[i]) < 0.0001) {
                // Ray is parallel to slab
                if (origin[i] < worldMin[i] || origin[i] > worldMax[i]) {
                    return null;
                }
            } else {
                const t1 = (worldMin[i] - origin[i]) / direction[i];
                const t2 = (worldMax[i] - origin[i]) / direction[i];
                
                tmin = Math.max(tmin, Math.min(t1, t2));
                tmax = Math.min(tmax, Math.max(t1, t2));
                
                if (tmin > tmax) {
                    return null;
                }
            }
        }
        
        return tmin >= 0 ? tmin : null;
    }
    
    camera.aabb = {
        min: [-0.22, -2.6, -0.23],  // Wider and taller collision box for better detection
        max: [0.22, 0.4, 0.23],     
    };
    
    // Mark camera as dynamic for collision detection
    camera.customProperties = { isDynamic: true };

    // HUD + overlay elementi
    const hudSheepHerded = document.getElementById('hud-sheep-herded');
    const hudSheepTotal = document.getElementById('hud-sheep-total');
    const hudTime = document.getElementById('hud-time');
        const hudObjective = document.getElementById('hud-objective');

    const levelCompleteOverlay = document.getElementById('levelComplete');
    const levelCompleteText = document.getElementById('levelComplete-text');
    const levelCompleteTime = document.getElementById('levelComplete-time');
    const levelCompleteRestart = document.getElementById('levelComplete-restart');

    const pauseMenu = document.getElementById('pauseMenu');
    const pauseResumeBtn = document.getElementById('pause-resume');
    const pauseRestartBtn = document.getElementById('pause-restart');

    let elapsedTime = 0;   // v sekundah (če je dt v ms, poglej komentar v update)
    let sheepHerded = 0;
    let sheepTotal = 14;
    let levelFinished = false;
    let paused = false;

    function formatTime(totalSeconds) {
    const sec = Math.max(0, totalSeconds);
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    const mm = String(minutes).padStart(2, '0');
        const ss = String(seconds).padStart(2, '0');
        return `${mm}:${ss}`;
    }

    function refreshHud() {
    if (hudTime) {
        hudTime.textContent = formatTime(elapsedTime);
    }
    if (hudSheepHerded) {
        hudSheepHerded.textContent = sheepHerded;
    }
    if (hudSheepTotal) {
            hudSheepTotal.textContent = sheepTotal;
        }
    }

    function setObjective(text) {
    if (hudObjective) {
            hudObjective.textContent = text;
        }
    }

    function levelComplete() {
    levelFinished = true;
    refreshHud();

    if (levelCompleteOverlay) {
        if (levelCompleteText) {
            levelCompleteText.textContent = 'Vse ovce so v ogradi!';
        }
        if (levelCompleteTime) {
            levelCompleteTime.textContent = formatTime(elapsedTime);
        }
            levelCompleteOverlay.classList.remove('hidden');
        }
    }

    function setSheepCounts(herded, total) {
    sheepHerded = Math.max(0, herded | 0);
    sheepTotal = Math.max(0, total | 0);
    refreshHud();

    // 🔗 WIN CHECK:
    // Ko boš imel sistem za ovce, iz njega kličeš:
    //   gameLevel.setSheepCounts(trenutnoVOgradi, vseSkup);
    // Če so vse ovce v ogradi, se levelComplete() sproži avtomatsko.
    if (sheepTotal > 0 && sheepHerded >= sheepTotal && !levelFinished) {
            levelComplete();
        }
    }

    function setPaused(value) {
        if (levelFinished) return;
        paused = value;
        if (pauseMenu) {
            if (paused) {
                pauseMenu.classList.remove('hidden');
                document.exitPointerLock();
            } else {
                pauseMenu.classList.add('hidden');
                canvas.requestPointerLock();
            }
        }
    }

        if (levelCompleteRestart) {
        levelCompleteRestart.addEventListener('click', () => {
            window.location.reload();
        });
    }

    if (pauseResumeBtn) {
        pauseResumeBtn.addEventListener('click', () => {
            setPaused(false);
        });
    }

    if (pauseRestartBtn) {
        pauseRestartBtn.addEventListener('click', () => {
            window.location.reload();
        });
    }

        window.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' || e.code === 'KeyP') {
            setPaused(!paused);
        }
    });

    // 🔗 API za kasneje, ko dodate ovce:
    // npr. v svojem SheepManager.js:
    //   gameLevel.setSheepCounts(trenutnoVOgradi, vseSkup);
    //   gameLevel.setObjective("Še 3 ovce do ograje!");
    //   // (po želji) gameLevel.levelComplete();
    window.gameLevel = {
        setSheepCounts,
        setObjective,
        levelComplete,
        setPaused,
    };


    const physics = new Physics(scene);
    for (const entity of scene) {
        const model = entity.getComponentOfType(Model);
        if (!model || !model.primitives) {
            continue;
        }

        // Calculate bounding boxes only for primitives with valid meshes
        const boxes = [];
        for (const primitive of model.primitives) {
            if (primitive.mesh && primitive.mesh.vertices && primitive.mesh.vertices.length > 0) {
                try {
                    const box = calculateAxisAlignedBoundingBox(primitive.mesh);
                    if (box && box.min && box.max && 
                        box.min.length === 3 && box.max.length === 3) {
                        boxes.push(box);
                    } else {
                        console.warn('Invalid box calculated:', box, 'for entity:', entity);
                    }
                } catch (e) {
                    console.warn('Failed to calculate AABB for primitive:', e);
                }
            }
        }
        
        if (boxes.length === 0) {
            // Skip entities without valid collision boxes (like parent nodes)
            continue;
        }
        
        try {
            entity.aabb = mergeAxisAlignedBoundingBoxes(boxes);
        } catch (e) {
            console.error('Failed to merge AABBs for entity:', entity, 'boxes:', boxes, 'error:', e);
            continue;
        }
        
        // Detect walls - one dimension is much larger than the others
        const size = [
            entity.aabb.max[0] - entity.aabb.min[0],
            entity.aabb.max[1] - entity.aabb.min[1],
            entity.aabb.max[2] - entity.aabb.min[2],
        ];
        
        const maxSize = Math.max(...size);
        const minSize = Math.min(...size);
        
        // Walls have one dimension much larger (ratio > 4)
        const isWall = (maxSize > minSize * 4);
        
        // For walls, reduce the smaller dimensions but keep the thickness (smallest dimension)
        let scaleX = 0.7;
        let scaleY = 0.7;
        let scaleZ = 0.9;
        
        if (isWall) {
            // Find which dimension is largest (the length) and reduce the others
            if (size[0] === maxSize) {
                // Wall runs along X axis - reduce Y and Z but not too much
                scaleY = 0.1;
                scaleZ = 0.4; // Keep more Z thickness for better collision
            } else if (size[2] === maxSize) {
                // Wall runs along Z axis - reduce X and Y but not too much
                scaleX = 0.1; // Keep more X thickness for better collision
                scaleY = 0.4;
            } else {
                // Wall runs along Y axis (vertical) - reduce X and Z
                scaleX = 0.4;
                scaleZ = 0.7;
            }
        }
        
        if (sheepNodes.has(entity)) {
            scaleX = scaleY = scaleZ = 0.9;
        }
        
        const center = [
            (entity.aabb.min[0] + entity.aabb.max[0]) / 2,
            (entity.aabb.min[1] + entity.aabb.max[1]) / 2,
            (entity.aabb.min[2] + entity.aabb.max[2]) / 2,
        ];
        const halfSize = [
            (entity.aabb.max[0] - entity.aabb.min[0]) / 2 * scaleX,
            (entity.aabb.max[1] - entity.aabb.min[1]) / 2 * scaleY,
            (entity.aabb.max[2] - entity.aabb.min[2]) / 2 * scaleZ,
        ];
        entity.aabb = {
            min: [center[0] - halfSize[0], center[1] - halfSize[1], center[2] - halfSize[2]],
            max: [center[0] + halfSize[0], center[1] + halfSize[1], center[2] + halfSize[2]],
        };
        
        // Mark sheep mesh nodes as dynamic, all others as static
        if (sheepNodes.has(entity)) {
            if (!entity.customProperties) {
                entity.customProperties = {};
            }
            entity.customProperties.isDynamic = true;
            
            // Make AABB much taller for easier raycast detection
            // Keep horizontal collision reasonable but make vertical hitbox tall
            const yIncrease = 15; // Make it very tall for clicking
            const xzIncrease = 2; // Wider horizontal detection
            entity.aabb.min[0] -= xzIncrease;
            entity.aabb.max[0] += xzIncrease;
            entity.aabb.min[1] -= yIncrease;
            entity.aabb.max[1] += yIncrease;
            entity.aabb.min[2] -= xzIncrease;
            entity.aabb.max[2] += xzIncrease;
            
        } else {
            // Mark all entities with meshes as static for collision
            if (!entity.customProperties) {
                entity.customProperties = {};
            }
            entity.customProperties.isStatic = true;
        }
    }

    // Add camera to scene for physics calculations
    scene.push(camera);
    
    // Initialize HUD with sheep count
    setSheepCounts(0, 12); // 0 herded, 12 total sheep
    
    refreshHud();

    function update(time, dt) {
        if (!levelFinished && !paused) {
            elapsedTime += dt;
            refreshHud();

            for (const entity of scene) {
                for (const component of entity.components) {
                    component.update?.(time, dt);
                }
            }

            physics.update(time, dt);
        }
    }

    function render() {
        renderer.render(scene, camera);
    }

    function resize({ displaySize: { width, height }}) {
        camera.getComponentOfType(Camera).aspect = width / height;
    }

    new ResizeSystem({ canvas, resize }).start();
    new UpdateSystem({ update, render }).start();
}