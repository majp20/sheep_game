import { GLTFLoader } from 'engine/loaders/GLTFLoader.js';
import { Entity, Transform, Model } from 'engine/core/core.js';
import { SheepController } from './Sheep.controller.js';

// Helper function to deep clone an entity and its hierarchy
function cloneEntity(originalEntity) {
    const clonedEntity = new Entity();
    
    // Clone all components
    for (const component of originalEntity.components) {
        if (component instanceof Transform) {
            clonedEntity.addComponent(new Transform({
                translation: [...component.translation],
                rotation: [...component.rotation],
                scale: [...component.scale]
            }));
        } else if (component instanceof Model) {
            // Share the model data (meshes, materials) - don't deep clone
            clonedEntity.addComponent(component);
        } else {
            // For other components, share the reference
            clonedEntity.addComponent(component);
        }
    }
    
    // Copy custom properties if any
    if (originalEntity.customProperties) {
        clonedEntity.customProperties = { ...originalEntity.customProperties };
    }
    
    return clonedEntity;
}

export async function loadSheep(scene) {
    // Plane: base mesh ~[-3 to +1] with scale [40, 1, 40] = Map area: ~[-120, -120] to [+38, +38]
    // Safe spawn zone: -115 to +33 (5 units margin from edges)
    
    const sheepPositions = [
        [31, 2.7, 28],
        [-95, 2.7, 25],
        [25, 2.7, -95],
        [-105, 2.7, -105],
        [33, 2.7, -45],
        [-75, 2.7, 30],
        [-45, 2.7, -110],
        [20, 2.7, -65],
        [-11, 2.7, 5],
        [10, 2.7, 33],
        [-85, 2.7, -75],
        [30, 2.7, -20],
        [10, 2.7, -20],
        [2, 2.7, -110]
    ];

    const allSheepNodes = new Set();

    // Load GLTF once - browser will cache the file
    const sheepLoader = new GLTFLoader();
    await sheepLoader.load(new URL('./scene/ovca.gltf', import.meta.url));
    
    // Load the template scene once
    const templateScene = sheepLoader.loadScene();

    // Create multiple sheep instances by cloning
    for (let i = 0; i < sheepPositions.length; i++) {
        // Clone each entity in the template
        const clonedSheep = [];
        for (const node of templateScene) {
            const clonedNode = cloneEntity(node);
            clonedSheep.push(clonedNode);
        }
        
        const sheep = clonedSheep[0];

        // Position this sheep instance
        const sheepTransform = sheep.getComponentOfType(Transform);
        sheepTransform.translation = sheepPositions[i];
        sheepTransform.scale = [0.1, 0.1, 0.1];

        // Add SheepController to make it move
        sheep.addComponent(new SheepController(sheep, {
            moveSpeed: 2,
            directionChangeInterval: 3,
            mapBounds: { min: [-115, -115], max: [33, 33] }
        }));

        // Add all nodes from this sheep to the scene
        for (const node of clonedSheep) {
            scene.push(node);
            allSheepNodes.add(node);
        }
    }

    // Return the set of all sheep nodes for collision setup
    return allSheepNodes;
}

export function setupSheepCollision(entity, sheepNodes) {
    // Check if this entity is a sheep node
    if (sheepNodes.has(entity)) {
        if (!entity.customProperties) {
            entity.customProperties = {};
        }
        entity.customProperties.isDynamic = true;
        
        // Increase sheep's X and Z collision box for better detection
        const xzIncrease = 0.5;
        entity.aabb.min[0] -= xzIncrease;
        entity.aabb.max[0] += xzIncrease;
        entity.aabb.min[2] -= xzIncrease;
        entity.aabb.max[2] += xzIncrease;
        
        return true;
    }
    return false;
}
