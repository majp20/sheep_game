import { ResizeSystem } from 'engine/systems/ResizeSystem.js';
import { UpdateSystem } from 'engine/systems/UpdateSystem.js';

import { GLTFLoader } from 'engine/loaders/GLTFLoader.js';
import { UnlitRenderer } from 'engine/renderers/UnlitRenderer.js';
import { FirstPersonController } from 'engine/controllers/FirstPersonController.js';

import { Camera, Model, Transform } from 'engine/core/core.js';

import {
    calculateAxisAlignedBoundingBox,
    mergeAxisAlignedBoundingBoxes,
} from 'engine/core/MeshUtils.js';

import { Physics } from './Physics.js';

const canvas = document.querySelector('canvas');
const renderer = new UnlitRenderer(canvas);
await renderer.initialize();

const loader = new GLTFLoader();
await loader.load(new URL('./scene/gozd.gltf', import.meta.url));

const scene = loader.loadScene();
const camera = loader.loadNode('Camera');

// Increase camera far clipping plane for better visibility
const cameraComponent = camera.getComponentOfType(Camera);
cameraComponent.far = 500; // Increase from default 100 to 500

camera.addComponent(new FirstPersonController(camera, canvas, {
    acceleration: 90,
    maxSpeed: 15,
    pointerSensitivity: 0.003,
}));
camera.aabb = {
    min: [-0.15, -0.8, -0.15],
    max: [0.15, 0.8, 0.15],
};
// Mark camera as dynamic for collision detection
camera.customProperties = { isDynamic: true };

const physics = new Physics(scene);
for (const entity of scene) {
    const model = entity.getComponentOfType(Model);
    if (!model) {
        continue;
    }

    const boxes = model.primitives.map(primitive => calculateAxisAlignedBoundingBox(primitive.mesh));
    entity.aabb = mergeAxisAlignedBoundingBoxes(boxes);
    
    // Detect walls and corners
    const size = [
        entity.aabb.max[0] - entity.aabb.min[0],
        entity.aabb.max[1] - entity.aabb.min[1],
        entity.aabb.max[2] - entity.aabb.min[2],
    ];
    
    const maxSize = Math.max(...size);
    const minSize = Math.min(...size);
    const midSize = size[0] + size[1] + size[2] - maxSize - minSize;
    
    // Corners: Two dimensions are similar and large (L-shaped or square-ish)
    // Walls: One dimension is much larger than the others
    const isCorner = (maxSize < minSize * 8) && (midSize > minSize * 1.5);
    const isWall = (maxSize > minSize * 4) && !isCorner;
    
    // Corners: keep larger collision boxes (85%) to prevent clipping
    // Walls: smaller collision boxes (60%) to allow closer approach
    // Trees/cylinders: full size for proper collision
    let scale = 1.0;
    if (isCorner) {
        scale = 0.85;
    } else if (isWall) {
        scale = 0.8;
    }
    
    const center = [
        (entity.aabb.min[0] + entity.aabb.max[0]) / 2,
        (entity.aabb.min[1] + entity.aabb.max[1]) / 2,
        (entity.aabb.min[2] + entity.aabb.max[2]) / 2,
    ];
    const halfSize = [
        (entity.aabb.max[0] - entity.aabb.min[0]) / 2 * scale,
        (entity.aabb.max[1] - entity.aabb.min[1]) / 2 * scale,
        (entity.aabb.max[2] - entity.aabb.min[2]) / 2 * scale,
    ];
    entity.aabb = {
        min: [center[0] - halfSize[0], center[1] - halfSize[1], center[2] - halfSize[2]],
        max: [center[0] + halfSize[0], center[1] + halfSize[1], center[2] + halfSize[2]],
    };
    
    // Mark all entities with meshes as static for collision (except camera)
    // This includes all cylinders and planes
    if (!entity.customProperties) {
        entity.customProperties = {};
    }
    entity.customProperties.isStatic = true;
}

// Add camera to scene for physics calculations
scene.push(camera);

function update(time, dt) {
    for (const entity of scene) {
        for (const component of entity.components) {
            component.update?.(time, dt);
        }
    }

    physics.update(time, dt);
}

function render() {
    renderer.render(scene, camera);
}

function resize({ displaySize: { width, height }}) {
    camera.getComponentOfType(Camera).aspect = width / height;
}

new ResizeSystem({ canvas, resize }).start();
new UpdateSystem({ update, render }).start();
