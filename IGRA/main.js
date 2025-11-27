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

    // Increase camera far clipping plane for better visibility
    const cameraComponent = camera.getComponentOfType(Camera);
    cameraComponent.far = 500; // Increase from default 100 to 500

    camera.addComponent(new FirstPersonController(camera, canvas, {
        acceleration: 90,
        maxSpeed: 13,
        pointerSensitivity: 0.001,
    }));
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
    let sheepTotal = 0;
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
            } else {
                pauseMenu.classList.add('hidden');
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
            
            // Increase sheep's X and Z collision box for better detection
            const xzIncrease = 0.4;
            entity.aabb.min[0] -= xzIncrease;
            entity.aabb.max[0] += xzIncrease;
            entity.aabb.min[2] -= xzIncrease;
            entity.aabb.max[2] += xzIncrease;
            
            console.log('Sheep entity with collision:', entity);
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