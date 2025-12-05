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
    const bgMusic = document.getElementById('bg-music');

    const sheepSoundPaths = [
        'audio/sheep1.mp3',
        'audio/sheep2.mp3',
        'audio/sheep3.mp3',
    ];

    function playRandomSheepSound() {
        const i = Math.floor(Math.random() * sheepSoundPaths.length);
        const audio = new Audio(sheepSoundPaths[i]);
        audio.play();
    }

    const sheepNodes = await loadSheep(scene);

    for (const sheep of sheepNodes) {
        const sheepController = sheep.components?.find(c => c.constructor.name === 'SheepController');
        if (sheepController) {
            sheepController.playerEntity = camera;
        }
    }

    const cameraComponent = camera.getComponentOfType(Camera);
    cameraComponent.far = 500;

    const controller = new FirstPersonController(camera, canvas, {
        acceleration: 50,
        maxSpeed: 12,  // Reduced from 20 to help prevent fence clipping
        pointerSensitivity: 0.001,
    });
    camera.addComponent(controller);
    
    controller.onRaycast = (origin, rayEnd, direction) => {
        let closestSheep = null;
        let closestDistance = Infinity;
        let closestDistToCenter = Infinity;
        let bestAlignment = -Infinity;
        let hitCount = 0;
        
        const maxDistance = Math.sqrt(
            (rayEnd[0] - origin[0]) ** 2 +
            (rayEnd[1] - origin[1]) ** 2 +
            (rayEnd[2] - origin[2]) ** 2
        );
        
        for (const sheep of sheepNodes) {
            const sheepTransform = sheep.getComponentOfType(Transform);
            if (!sheepTransform || !sheep.aabb) continue;
            
            const t = rayAABBIntersection(origin, direction, sheep.aabb, sheepTransform);
            if (t !== null && t <= maxDistance) {
                hitCount++;
                
                const sheepPos = sheepTransform.translation;
                
                const rayPoint = [
                    origin[0] + direction[0] * Math.max(t, 0),
                    origin[1] + direction[1] * Math.max(t, 0),
                    origin[2] + direction[2] * Math.max(t, 0)
                ];
                
                const dx = rayPoint[0] - sheepPos[0];
                const dy = rayPoint[1] - sheepPos[1];
                const dz = rayPoint[2] - sheepPos[2];
                const distToCenter = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
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
                
                if (alignment > 0.5 && alignment > bestAlignment) {
                    bestAlignment = alignment;
                    closestDistToCenter = distToCenter;
                    closestDistance = t;
                    closestSheep = sheep;
                }
            }
        }
        
        if (closestSheep) {
            let sheepController = closestSheep.components?.find(c => c.constructor.name === 'SheepController');
            
            if (!sheepController) {
                for (const sheep of sheepNodes) {
                    const controller = sheep.components?.find(c => c.constructor.name === 'SheepController');
                    if (controller) {
                        const sheepTransform = sheep.getComponentOfType(Transform);
                        const hitTransform = closestSheep.getComponentOfType(Transform);
                        
                        if (hitTransform && sheepTransform) {
                            const dx = hitTransform.translation[0] - sheepTransform.translation[0];
                            const dy = hitTransform.translation[1] - sheepTransform.translation[1];
                            const dz = hitTransform.translation[2] - sheepTransform.translation[2];
                            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                            
                            if (dist < 0.1) {
                                sheepController = controller;
                                break;
                            }
                        }
                    }
                }
            }
            
            if (sheepController) {
                sheepController.launch(direction, 20);
                playRandomSheepSound();
            }
        }
    };
    
    function rayAABBIntersection(origin, direction, aabb, transform) {
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
        min: [-0.22, -2.6, -0.23],
        max: [0.22, 0.4, 0.23],
    };
    
    camera.customProperties = { isDynamic: true };

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

    let elapsedTime = 0;
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

        if (bgMusic) {
            bgMusic.pause();
            bgMusic.currentTime = 0;
        }

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

        if (sheepTotal > 0 && sheepHerded >= sheepTotal && !levelFinished) {
            levelComplete();
        }
    }

    function setPaused(value) {
        if (levelFinished) return;
        paused = value;
        if (pauseMenu) {
            if (paused) {
                if (bgMusic) {
                    bgMusic.pause();
                }
                pauseMenu.classList.remove('hidden');
                document.exitPointerLock();
            } else {
                pauseMenu.classList.add('hidden');
                canvas.requestPointerLock();
                if (bgMusic) {
                    bgMusic.play();
                }
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

    window.gameLevel = {
        setSheepCounts,
        setObjective,
        levelComplete,
        setPaused,
    };

    const physics = new Physics(scene, {
        onSheepEnterSeno: (sheep) => {
            sheepHerded++;
            setSheepCounts(sheepHerded, sheepTotal);
        }
    });
    for (const entity of scene) {
        const model = entity.getComponentOfType(Model);
        if (!model || !model.primitives) {
            continue;
        }

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
            continue;
        }
        
        try {
            entity.aabb = mergeAxisAlignedBoundingBoxes(boxes);
        } catch (e) {
            console.error('Failed to merge AABBs for entity:', entity, 'boxes:', boxes, 'error:', e);
            continue;
        }
        
        const size = [
            entity.aabb.max[0] - entity.aabb.min[0],
            entity.aabb.max[1] - entity.aabb.min[1],
            entity.aabb.max[2] - entity.aabb.min[2],
        ];
        
        const maxSize = Math.max(...size);
        const minSize = Math.min(...size);
        
        // Check if this is a fence FIRST (before any scaling)
        const isFence = entity.name && (entity.name.toLowerCase().includes('fence') || entity.name === 'FENCE');
        const isSeno = entity.name && (entity.name.toLowerCase() === 'seno' || entity.name === 'SENO');
        
        const isWall = (maxSize > minSize * 4);
        
        let scaleX = 0.7;
        let scaleY = 0.7;
        let scaleZ = 0.9;
        
        if (isWall && !isFence) {
            if (size[0] === maxSize) {
                scaleY = 0.1;
                scaleZ = 0.4;
            } else if (size[2] === maxSize) {
                scaleX = 0.1;
                scaleY = 0.4;
            } else {
                scaleX = 0.4;
                scaleZ = 0.7;
            }
        }
        
        if (sheepNodes.has(entity)) {
            scaleX = scaleY = scaleZ = 0.9;
        }
        
        // FENCE FIX: Prevent clipping with thick collision boxes and corner protection
        // Player moves ~0.2 units/frame at maxSpeed=12. Fence must be significantly thicker.
        if (isFence) {
            // Make ALL dimensions generous to prevent corner clipping
            if (size[0] === maxSize) {
                // Fence runs along X axis
                scaleX = 1.0;  // Keep full length
                scaleY = 1.0;  // Keep full height
                scaleZ = 2.5;  // MAJOR thickness increase (250%)
            } else if (size[2] === maxSize) {
                // Fence runs along Z axis  
                scaleX = 2.5;  // MAJOR thickness increase (250%)
                scaleY = 1.0;  // Keep full height
                scaleZ = 1.0;  // Keep full length
            } else {
                // Unusual orientation - be very conservative
                scaleX = 2.0;
                scaleY = 1.0;
                scaleZ = 2.0;
            }
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
        
        
        if (sheepNodes.has(entity)) {
            if (!entity.customProperties) {
                entity.customProperties = {};
            }
            entity.customProperties.isDynamic = true;
            entity.customProperties.isSheep = true;  // Mark explicitly as sheep
            
            // CRITICAL FIX: Make AABB local (centered at 0,0,0) not absolute world coordinates
            // The AABB should be relative to the entity's transform, not absolute positions
            const currentAABB = entity.aabb;
            const centerSheep = [
                (currentAABB.min[0] + currentAABB.max[0]) / 2,
                (currentAABB.min[1] + currentAABB.max[1]) / 2,
                (currentAABB.min[2] + currentAABB.max[2]) / 2
            ];
            const halfSizeSheep = [
                (currentAABB.max[0] - currentAABB.min[0]) / 2,
                (currentAABB.max[1] - currentAABB.min[1]) / 2,
                (currentAABB.max[2] - currentAABB.min[2]) / 2
            ];
            
            // Moderate AABB expansion - large enough for raycast, fence collision handled by Physics.js
            const yIncrease = 8;  // Moderate size for hit detection
            const xzIncrease = 1.5;  // Moderate horizontal expansion
            
            // Create LOCAL AABB centered at origin
            entity.aabb = {
                min: [-(halfSizeSheep[0] + xzIncrease), -(halfSizeSheep[1] + yIncrease), -(halfSizeSheep[2] + xzIncrease)],
                max: [halfSizeSheep[0] + xzIncrease, halfSizeSheep[1] + yIncrease, halfSizeSheep[2] + xzIncrease]
            };
            
        } else if (isFence) {
            if (!entity.customProperties) {
                entity.customProperties = {};
            }
            entity.customProperties.isStatic = true;
        } else if (isSeno) {
            // Seno (hay) - sheep stop when stepping on it
            if (!entity.customProperties) {
                entity.customProperties = {};
            }
            entity.customProperties.isStatic = true;
            entity.customProperties.isSeno = true;
        } else {
            if (!entity.customProperties) {
                entity.customProperties = {};
            }
            entity.customProperties.isStatic = true;
        }
    }

    scene.push(camera);
    
    setSheepCounts(0, 14);
    
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
