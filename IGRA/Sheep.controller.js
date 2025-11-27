import { quat, vec3, mat4 } from 'glm';
import { Transform } from 'engine/core/core.js';

export class SheepController {

    constructor(entity, {
        moveSpeed = 1.5,              
        directionChangeInterval = 7, // Seconds between random direction changes
        mapBounds = { min: [-115, -115], max: [33, 33] }, // Map boundaries
        pauseChance = 0.4, // 30% chance to pause instead of changing direction
        pauseDuration = 2, // Seconds to pause when stopping
        bobHeight = 0.03, // How high the sheep bobs when walking
        bobSpeed = 8, // How fast the bobbing animation is
        rotationSpeed = 5, // How fast the sheep rotates to face new direction (radians/sec)
    } = {}) {
        this.entity = entity;
        
        // Movement properties
        this.moveSpeed = moveSpeed;
        this.directionChangeInterval = directionChangeInterval;
        this.mapBounds = mapBounds;
        this.pauseChance = pauseChance;
        this.pauseDuration = pauseDuration;
        this.bobHeight = bobHeight;
        this.bobSpeed = bobSpeed;
        this.rotationSpeed = rotationSpeed;
        
        // Current state
        this.currentDirection = [0, 0]; // [x, z] direction vector
        this.timeSinceDirectionChange = 0;
        this.isMoving = true;
        this.isPaused = false;
        this.pauseTimeRemaining = 0;
        
        // Animation state
        this.walkTime = 0; // Accumulates time for walk animation
        this.baseY = null; // Store the base Y position
        this.targetRotation = null; // Target rotation quaternion
        
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


    update(time, dt) {
        // Skip if dt is too small or too large (physics instability)
        if (dt <= 0 || dt > 0.1) {
            return;
        }

        // Handle pause state
        if (this.isPaused) {
            this.pauseTimeRemaining -= dt;
            if (this.pauseTimeRemaining <= 0) {
                this.isPaused = false;
                this.pickRandomDirection(); // Pick new direction after pause
            }
            return; // Don't move while paused
        }

        this.timeSinceDirectionChange += dt;
        if (this.timeSinceDirectionChange >= this.directionChangeInterval) {
            // Randomly decide to pause or change direction
            if (Math.random() < this.pauseChance) {
                // Start pause
                this.isPaused = true;
                this.pauseTimeRemaining = this.pauseDuration;
                this.currentDirection = [0, 0]; // Stop moving
            } else {
                // Change direction
                this.pickRandomDirection();
            }
            this.timeSinceDirectionChange = 0;
        }

        const transform = this.entity.getComponentOfType(Transform);
        if (!transform) {
            return;
        }

        // Store base Y position on first update
        if (this.baseY === null) {
            this.baseY = transform.translation[1];
        }

        // Get normalized direction
        let [dx, dz] = this.currentDirection;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0) {
            dx /= len;
            dz /= len;
        } else {
            // If direction is [0,0], sheep is stationary - reset to base Y
            transform.translation[1] = this.baseY;
            return;
        }

        // Movement step: v * dt
        const speed = this.moveSpeed;
        const stepX = dx * speed * dt;
        const stepZ = dz * speed * dt;

        // Apply movement
        transform.translation[0] += stepX;
        transform.translation[2] += stepZ;
        
        // Walking animation: bobbing motion
        this.walkTime += dt;
        const bobOffset = Math.sin(this.walkTime * this.bobSpeed) * this.bobHeight;
        transform.translation[1] = this.baseY + bobOffset;

        // Smooth rotation to face movement direction
        // Calculate target rotation angle from direction vector
        const targetAngle = Math.atan2(dx, dz); // atan2(x, z) for Y-axis rotation
        const targetRotation = quat.create();
        quat.rotateY(targetRotation, targetRotation, targetAngle);
        
        // Smoothly interpolate (slerp) from current rotation to target rotation
        const rotationLerpSpeed = this.rotationSpeed * dt; // Adjust rotation speed by delta time
        const t = Math.min(rotationLerpSpeed, 1); // Clamp to [0, 1] for smooth interpolation
        
        quat.slerp(transform.rotation, transform.rotation, targetRotation, t); //smooth rotation

        // Clamp to boundaries (prevent going out of bounds)
        const x = transform.translation[0];
        const z = transform.translation[2];

        if (x < this.mapBounds.min[0]) {
            transform.translation[0] = this.mapBounds.min[0];
            this.currentDirection[0] = Math.abs(this.currentDirection[0]); // bounce inward
        } else if (x > this.mapBounds.max[0]) {
            transform.translation[0] = this.mapBounds.max[0];
            this.currentDirection[0] = -Math.abs(this.currentDirection[0]); // bounce inward
        }

        if (z < this.mapBounds.min[1]) {
            transform.translation[2] = this.mapBounds.min[1];
            this.currentDirection[1] = Math.abs(this.currentDirection[1]); // bounce inward
        } else if (z > this.mapBounds.max[1]) {
            transform.translation[2] = this.mapBounds.max[1];
            this.currentDirection[1] = -Math.abs(this.currentDirection[1]); // bounce inward
        }
    }

}