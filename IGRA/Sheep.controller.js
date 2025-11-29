import { quat, vec3, mat4 } from 'glm';
import { Transform } from 'engine/core/core.js';

export class SheepController {

    constructor(entity, {
        moveSpeed = 1.5,              
        directionChangeInterval = 7, // Seconds between random direction changes
        mapBounds = { min: [-115, -115], max: [33, 33] }, // Map boundaries
        pauseChance = 0.2, // Chance to pause instead of changing direction
        pauseDuration = 2, // Seconds to pause when stopping
        bobHeight = 0.03, // How high the sheep bobs when walking
        bobSpeed = 8, // How fast the bobbing animation is
        rotationSpeed = 5, // How fast the sheep rotates to face new direction (radians/sec)
        // Flee behavior settings
        fleeRadius = 7, // Distance at which sheep start fleeing from player
        safeRadius = 35, // Distance at which sheep stop fleeing
        fleeSpeedMultiplier = 2.0, // Speed multiplier when fleeing (faster than normal)
        // Panic behavior settings (after being hit)
        panicDuration = 2.0, // How long panic mode lasts (seconds)
        panicSpeedMultiplier = 2.5, // Speed multiplier during panic (2-3× faster)
        panicDirectionChangeInterval = 0.5, // How often to change direction during panic (0.4-0.8s)
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
        
        // Flee behavior properties
        this.fleeRadius = fleeRadius;
        this.safeRadius = safeRadius;
        this.fleeSpeedMultiplier = fleeSpeedMultiplier;
        this.isFleeing = false;
        this.playerEntity = null; // Will be set by main.js
        
        // Panic behavior properties (after being hit)
        this.isPanic = false;
        this.panicTimer = 0;
        this.panicDuration = panicDuration;
        this.panicSpeedMultiplier = panicSpeedMultiplier;
        this.panicDirectionChangeInterval = panicDirectionChangeInterval;
        this.panicTimeSinceDirectionChange = 0;
        
        // Current state
        this.currentDirection = [0, 0]; // [x, z] direction vector
        this.timeSinceDirectionChange = 0;
        this.isMoving = true;
        this.isPaused = false;
        this.pauseTimeRemaining = 0;
        
        // Launched/bouncing state
        this.isLaunched = false;
        this.launchVelocity = [0, 0, 0]; // 3D velocity when launched
        this.launchGravity = -9.8; // Gravity for arc motion
        this.launchDuration = 0; // Time sheep has been airborne
        this.shouldEnterPanicAfterLanding = false;
        
        // Animation state
        this.walkTime = 0; // Accumulates time for walk animation
        this.baseY = null; // Store the base Y position
        this.targetRotation = null; // Target rotation quaternion
        this.launchInvulnerable = false;
        
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


    launch(direction, speed = 5) {
        // IMMEDIATELY set launch state to prevent any other behavior
        this.isLaunched = true;
        
        // Launch sheep in the given direction with upward arc
        this.launchVelocity = [
            direction[0] * speed,
            3, // Upward component for arc
            direction[2] * speed
        ];
        this.launchDuration = 0;
        
        // Cancel any pause or normal movement immediately
        this.isPaused = false;
        this.pauseTimeRemaining = 0;
        this.currentDirection = [0, 0];
        
        // Mark as invulnerable for collisions
        this.launchInvulnerable = true; // Ignore collisions for first 0.3 seconds
        
        // Reset direction change timer to prevent immediate direction change after landing
        this.timeSinceDirectionChange = 0;
        
        // Mark that sheep should enter panic after landing
        this.shouldEnterPanicAfterLanding = true;
    }

    update(time, dt) {
        // Skip if dt is too small or too large (physics instability)
        if (dt <= 0 || dt > 0.1) {
            return;
        }

        const transform = this.entity.getComponentOfType(Transform);
        if (!transform) {
            return;
        }

        // Store base Y position on first update
        if (this.baseY === null) {
            this.baseY = transform.translation[1];
        }

        // ========================================================================
        // PRIORITY 1: LAUNCH STATE (physics-based knockback)
        // ========================================================================
        if (this.isLaunched) {
            this.launchDuration += dt;
            
            // Remove invulnerability after 0.3 seconds
            if (this.launchInvulnerable && this.launchDuration > 0.3) {
                this.launchInvulnerable = false;
            }
            
            // Apply gravity to Y velocity
            this.launchVelocity[1] += this.launchGravity * dt;
            
            // Store old position for collision detection
            const oldPos = vec3.clone(transform.translation);
            
            // Update position
            transform.translation[0] += this.launchVelocity[0] * dt;
            transform.translation[1] += this.launchVelocity[1] * dt;
            transform.translation[2] += this.launchVelocity[2] * dt;
            
            // Check boundaries - stop if hit wall
            if (transform.translation[0] < this.mapBounds.min[0] || 
                transform.translation[0] > this.mapBounds.max[0] ||
                transform.translation[2] < this.mapBounds.min[1] || 
                transform.translation[2] > this.mapBounds.max[1]) {
                // Hit boundary - stop launch
                transform.translation[0] = oldPos[0];
                transform.translation[2] = oldPos[2];
                transform.translation[1] = this.baseY;
                this.isLaunched = false;
                this.launchVelocity = [0, 0, 0];
                
                // Enter panic mode after landing
                if (this.shouldEnterPanicAfterLanding) {
                    this.enterPanicMode();
                    this.shouldEnterPanicAfterLanding = false;
                } else {
                    this.pickRandomDirection();
                }
                return;
            }
            
            // Check if sheep hit ground (return to baseY or below)
            // Only land if sheep has been in the air for at least 0.2 seconds
            if (this.baseY !== null && transform.translation[1] <= this.baseY && this.launchDuration > 0.2) {
                transform.translation[1] = this.baseY;
                this.isLaunched = false;
                this.launchVelocity = [0, 0, 0];
                
                // Enter panic mode after landing from being hit
                if (this.shouldEnterPanicAfterLanding) {
                    this.enterPanicMode();
                    this.shouldEnterPanicAfterLanding = false;
                } else {
                    this.pickRandomDirection();
                }
            }
            
            return; // Skip all other behavior while launched
        }

        // ========================================================================
        // PRIORITY 2: PANIC STATE (after being hit - overrides everything else)
        // ========================================================================
        if (this.isPanic) {
            this.panicTimer -= dt;
            this.panicTimeSinceDirectionChange += dt;
            
            // Exit panic mode when timer expires
            if (this.panicTimer <= 0) {
                this.isPanic = false;
                this.panicTimeSinceDirectionChange = 0;
                this.pickRandomDirection();
                // Continue to normal logic below (don't return, fall through to flee/wander)
            } else {
                // Change direction during panic at specified interval (0.4-0.8s range)
                if (this.panicTimeSinceDirectionChange >= this.panicDirectionChangeInterval) {
                    this.pickRandomDirection();
                    this.panicTimeSinceDirectionChange = 0;
                }
                
                // Get normalized direction
                let [dx, dz] = this.currentDirection;
                const len = Math.sqrt(dx * dx + dz * dz);
                if (len > 0) {
                    dx /= len;
                    dz /= len;
                }
                
                // Move at high panic speed (2-3× normal speed)
                const panicSpeed = this.moveSpeed * this.panicSpeedMultiplier;
                transform.translation[0] += dx * panicSpeed * dt;
                transform.translation[2] += dz * panicSpeed * dt;
                
                // Apply faster bobbing animation during panic
                this.walkTime += dt * 2.5;
                const bobOffset = Math.sin(this.walkTime * this.bobSpeed) * this.bobHeight;
                transform.translation[1] = this.baseY + bobOffset;
                
                // Rotate quickly to face movement direction
                const targetAngle = Math.atan2(dx, dz);
                const targetRotation = quat.create();
                quat.rotateY(targetRotation, targetRotation, targetAngle);
                const rotationLerpSpeed = this.rotationSpeed * 3 * dt; // Very fast rotation
                const t = Math.min(rotationLerpSpeed, 1);
                quat.slerp(transform.rotation, transform.rotation, targetRotation, t);
                
                // Apply boundary constraints with direction bounce (sheep collide with walls)
                this.applyBoundaryConstraintsWithBounce(transform);
                return; // Skip all other behavior during panic
            }
        }

        // ========================================================================
        // PRIORITY 3: FLEE STATE (when player is near - only if NOT panicking)
        // ========================================================================
        if (this.playerEntity && !this.isPanic) {
            const playerTransform = this.playerEntity.getComponentOfType(Transform);
            if (playerTransform) {
                const dx = playerTransform.translation[0] - transform.translation[0];
                const dz = playerTransform.translation[2] - transform.translation[2];
                const distanceToPlayer = Math.sqrt(dx * dx + dz * dz);
                
                // Start fleeing if player is within fleeRadius (6-8 units)
                if (distanceToPlayer < this.fleeRadius) {
                    if (!this.isFleeing) {
                        this.isFleeing = true;
                        this.isPaused = false; // Cancel any pause
                        this.pauseTimeRemaining = 0;
                    }
                }
                // Stop fleeing only when reaching safe distance (>15 units)
                else if (distanceToPlayer > this.safeRadius && this.isFleeing) {
                    this.isFleeing = false;
                    this.pickRandomDirection();
                }
            }
        }

        // ========================================================================
        // FLEE MOVEMENT (if currently fleeing)
        // ========================================================================
        if (this.isFleeing && this.playerEntity) {
            const playerTransform = this.playerEntity.getComponentOfType(Transform);
            if (playerTransform) {
                // CONSTANTLY recalculate flee direction (away from player)
                const toPlayerX = playerTransform.translation[0] - transform.translation[0];
                const toPlayerZ = playerTransform.translation[2] - transform.translation[2];
                const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerZ * toPlayerZ);
                
                let fleeX = 0, fleeZ = 0;
                if (distToPlayer > 0.01) {
                    // Direction directly away from player
                    fleeX = -toPlayerX / distToPlayer;
                    fleeZ = -toPlayerZ / distToPlayer;
                } else {
                    // Player is on top of sheep, pick random direction
                    const angle = Math.random() * Math.PI * 2;
                    fleeX = Math.sin(angle);
                    fleeZ = Math.cos(angle);
                }
                
                // Store old position for collision detection
                const oldX = transform.translation[0];
                const oldZ = transform.translation[2];
                
                // Move at flee speed (1.5× or 2× normal speed)
                const fleeSpeed = this.moveSpeed * this.fleeSpeedMultiplier;
                transform.translation[0] += fleeX * fleeSpeed * dt;
                transform.translation[2] += fleeZ * fleeSpeed * dt;
                
                // Apply faster bobbing during flee
                this.walkTime += dt * 1.8;
                const bobOffset = Math.sin(this.walkTime * this.bobSpeed) * this.bobHeight;
                transform.translation[1] = this.baseY + bobOffset;
                
                // Rotate smoothly to face flee direction
                const targetAngle = Math.atan2(fleeX, fleeZ);
                const targetRotation = quat.create();
                quat.rotateY(targetRotation, targetRotation, targetAngle);
                const rotationLerpSpeed = this.rotationSpeed * 2.5 * dt; // Faster rotation when fleeing
                const t = Math.min(rotationLerpSpeed, 1);
                quat.slerp(transform.rotation, transform.rotation, targetRotation, t);
                
                // Apply boundary constraints with smart collision handling
                const hitWall = this.applyBoundaryConstraintsWithBounce(transform);
                
                // If we hit a wall while fleeing, adjust direction to continue fleeing
                if (hitWall) {
                    // Calculate new flee direction that's still away from player but avoids wall
                    const newToPlayerX = playerTransform.translation[0] - transform.translation[0];
                    const newToPlayerZ = playerTransform.translation[2] - transform.translation[2];
                    const newDist = Math.sqrt(newToPlayerX * newToPlayerX + newToPlayerZ * newToPlayerZ);
                    
                    if (newDist > 0.01) {
                        // Recalculate flee direction after bounce
                        this.currentDirection[0] = -newToPlayerX / newDist;
                        this.currentDirection[1] = -newToPlayerZ / newDist;
                    }
                }
                
                return; // Skip wandering behavior
            }
        }

        // ========================================================================
        // PRIORITY 4: NORMAL WANDERING BEHAVIOR
        // ========================================================================
        
        // Handle pause state
        if (this.isPaused) {
            this.pauseTimeRemaining -= dt;
            if (this.pauseTimeRemaining <= 0) {
                this.isPaused = false;
                this.pickRandomDirection();
            }
            // Stay still while paused (only bobbing)
            transform.translation[1] = this.baseY;
            return;
        }

        // Direction change timer
        this.timeSinceDirectionChange += dt;
        if (this.timeSinceDirectionChange >= this.directionChangeInterval) {
            // Randomly decide to pause or change direction
            if (Math.random() < this.pauseChance) {
                this.isPaused = true;
                this.pauseTimeRemaining = this.pauseDuration;
                this.currentDirection = [0, 0];
            } else {
                this.pickRandomDirection();
            }
            this.timeSinceDirectionChange = 0;
        }

        // Get normalized direction
        let [dx, dz] = this.currentDirection;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0) {
            dx /= len;
            dz /= len;
        } else {
            transform.translation[1] = this.baseY;
            return;
        }

        // Normal movement
        transform.translation[0] += dx * this.moveSpeed * dt;
        transform.translation[2] += dz * this.moveSpeed * dt;
        
        // Walking animation: bobbing motion
        this.walkTime += dt;
        const bobOffset = Math.sin(this.walkTime * this.bobSpeed) * this.bobHeight;
        transform.translation[1] = this.baseY + bobOffset;

        // Smooth rotation to face movement direction
        const targetAngle = Math.atan2(dx, dz);
        const targetRotation = quat.create();
        quat.rotateY(targetRotation, targetRotation, targetAngle);
        const rotationLerpSpeed = this.rotationSpeed * dt;
        const t = Math.min(rotationLerpSpeed, 1);
        quat.slerp(transform.rotation, transform.rotation, targetRotation, t);

        // Apply boundary constraints
        this.applyBoundaryConstraints(transform);
    }

    enterPanicMode() {
        this.isPanic = true;
        this.panicTimer = this.panicDuration;
        this.panicTimeSinceDirectionChange = 0;
        this.isPaused = false;
        this.isFleeing = false; // Panic overrides flee
        this.pickRandomDirection();
    }

    applyBoundaryConstraints(transform) {
        const x = transform.translation[0];
        const z = transform.translation[2];

        if (x < this.mapBounds.min[0]) {
            transform.translation[0] = this.mapBounds.min[0];
            this.currentDirection[0] = Math.abs(this.currentDirection[0]);
        } else if (x > this.mapBounds.max[0]) {
            transform.translation[0] = this.mapBounds.max[0];
            this.currentDirection[0] = -Math.abs(this.currentDirection[0]);
        }

        if (z < this.mapBounds.min[1]) {
            transform.translation[2] = this.mapBounds.min[1];
            this.currentDirection[1] = Math.abs(this.currentDirection[1]);
        } else if (z > this.mapBounds.max[1]) {
            transform.translation[2] = this.mapBounds.max[1];
            this.currentDirection[1] = -Math.abs(this.currentDirection[1]);
        }
    }

    applyBoundaryConstraintsWithBounce(transform) {
        const x = transform.translation[0];
        const z = transform.translation[2];
        let hitWall = false;

        // Check X boundaries and bounce direction
        if (x < this.mapBounds.min[0]) {
            transform.translation[0] = this.mapBounds.min[0];
            this.currentDirection[0] = Math.abs(this.currentDirection[0]); // Bounce right
            hitWall = true;
        } else if (x > this.mapBounds.max[0]) {
            transform.translation[0] = this.mapBounds.max[0];
            this.currentDirection[0] = -Math.abs(this.currentDirection[0]); // Bounce left
            hitWall = true;
        }

        // Check Z boundaries and bounce direction
        if (z < this.mapBounds.min[1]) {
            transform.translation[2] = this.mapBounds.min[1];
            this.currentDirection[1] = Math.abs(this.currentDirection[1]); // Bounce forward
            hitWall = true;
        } else if (z > this.mapBounds.max[1]) {
            transform.translation[2] = this.mapBounds.max[1];
            this.currentDirection[1] = -Math.abs(this.currentDirection[1]); // Bounce backward
            hitWall = true;
        }

        return hitWall;
    }

}