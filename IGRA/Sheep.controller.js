import { quat, vec3, mat4 } from 'glm';
import { Transform } from '../core/Transform.js';

export class SheepController {

    constructor(entity, {
        moveSpeed = 2,              
        directionChangeInterval = 3, // Seconds between random direction changes
        mapBounds = { min: [-115, -115], max: [33, 33] }, // Map boundaries
    } = {}) {
        this.entity = entity;
        
        // Movement properties
        this.moveSpeed = moveSpeed;
        this.directionChangeInterval = directionChangeInterval;
        this.mapBounds = mapBounds;
        
        // Current state
        this.currentDirection = [0, 0]; // [x, z] direction vector
        this.timeSinceDirectionChange = 0;
        this.isMoving = false;
        
        // Initialize with random direction
        this.pickRandomDirection();
    }
    pickRandomDirection() {
        const transform = this.entity.getComponentOfType(Transform);
        if (!transform) return;

        const x = transform.translation[0];
        const z = transform.translation[2];

        // Bounce off X boundaries
        if (x <= this.mapBounds.min[0]) {
            this.currentDirection = [1, 0];
            return;
        }
        if (x >= this.mapBounds.max[0]) {
            this.currentDirection = [-1, 0];
            return;
        }

        // Bounce off Z boundaries
        if (z <= this.mapBounds.min[1]) {
            this.currentDirection = [0, 1];
            return;
        }
        if (z >= this.mapBounds.max[1]) {
            this.currentDirection = [0, -1];
            return;
        }

        const angle = Math.random() * Math.PI * 2;

        const dx = Math.sin(angle);
        const dz = Math.cos(angle);

        this.currentDirection = [dx, dz];
    }


    update(dt) {
        this.timeSinceDirectionChange += dt;
        if(this.timeSinceDirectionChange >= this.directionChangeInterval) {
            pickRandomDirection();
            this.timeSinceDirectionChange=0;
        }

        //TODO
   
    }

}