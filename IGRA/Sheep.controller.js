import { quat, vec3, mat4 } from 'glm';
import { Transform } from 'engine/core/core.js';

export class SheepController {

    constructor(entity, {
        moveSpeed = 1.5,              
        directionChangeInterval = 7, // Seconds between random direction changes
        mapBounds = { min: [-115, -115], max: [33, 33] }, // Map boundaries
        pauseChance = 0.2, // Chance to pause instead of changing direction
        pauseDuration = 2, // Seconds to pause when stopping
        bobHeight = 0.04, // How high the sheep bobs when walking
        bobSpeed = 8, // How fast the bobbing animation is
        rotationSpeed = 5, // How fast the sheep rotates to face new direction (radians/sec)
        // Flee behavior settings
        fleeRadius = 10, // Distance at which sheep start fleeing from player
        safeRadius = 15, // Distance at which sheep stop fleeing
        fleeSpeedMultiplier = 6.0, // Speed multiplier when fleeing (faster than normal)
        // Panic behavior settings (after being hit)
        panicDuration = 2.0, // How long panic mode lasts (seconds)
        panicSpeedMultiplier = 4.5, // Speed multiplier during panic (2-3× faster)
        panicDirectionChangeInterval = 0.75, // How often to change direction during panic (0.4-0.8s)
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
        this.fleeCooldown = 0; // Cooldown timer for flee behavior
        this.fleeCooldownDuration = 6.0; // 3 seconds cooldown between flee activations
        
        // Collision-aware flee properties (FIX FOR INVISIBLE WALL BUG)
        this.fleeDirection = [0, 0]; // Stored flee direction (not recalculated every frame)
        this.fleeDirectionUpdateTimer = 0; // Only recalculate direction periodically
        this.fleeDirectionUpdateInterval = 0.1; // Update flee direction every 0.1s (faster response)
        this.lastFleePosition = [0, 0]; // Track position to detect stuck state
        this.fleeStuckCounter = 0; // Count frames where sheep barely moved
        this.fleeStuckThreshold = 0.5; // If moved less than this distance, consider stuck
        this.fleeForceEscapeTimer = 0; // Timer to force direction change if stuck too long
        
        // Fence zone detection (center area where sheep should not get stuck)
        this.fenceZone = { min: [-70, -25], max: [-20, 15] }; // Central fence area
        
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
        
        // DEBUG: Log position and state periodically
        this.debugTimer += dt;
        if (this.debugTimer >= this.debugInterval) {
            this.debugTimer = 0;
            /*
            const pos = transform.translation;
            const inFenceZone = pos[0] > this.fenceZone.min[0] && 
                               pos[0] < this.fenceZone.max[0] &&
                               pos[2] > this.fenceZone.min[1] && 
                               pos[2] < this.fenceZone.max[1];
            const distToFence = Math.min(
                Math.abs(pos[0] - this.fenceZone.min[0]),
                Math.abs(pos[0] - this.fenceZone.max[0]),
                Math.abs(pos[2] - this.fenceZone.min[1]),
                Math.abs(pos[2] - this.fenceZone.max[1])
            );
            console.log(`[SHEEP] Pos: (${pos[0].toFixed(1)}, ${pos[2].toFixed(1)}) | State: ${this.isLaunched ? 'LAUNCH' : this.isPanic ? 'PANIC' : this.isFleeing ? 'FLEE' : 'WANDER'} | InFence: ${inFenceZone} | DistToFence: ${distToFence.toFixed(1)}`);
            */
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

        // Update flee cooldown
        if (this.fleeCooldown > 0) {
            this.fleeCooldown -= dt;
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
                
                // Start fleeing if player is within fleeRadius (6-8 units) and cooldown is over
                if (distanceToPlayer < this.fleeRadius && this.fleeCooldown <= 0) {
                    if (!this.isFleeing) {
                        this.isFleeing = true;
                        this.isPaused = false; // Cancel any pause
                        this.pauseTimeRemaining = 0;
                        
                        // Initialize flee direction and tracking (FIX: store initial flee direction)
                        this.fleeDirection = [
                            -dx / distanceToPlayer,
                            -dz / distanceToPlayer
                        ];
                        this.fleeDirectionUpdateTimer = 0;
                        this.lastFleePosition = [transform.translation[0], transform.translation[2]];
                        this.fleeStuckCounter = 0;
                    }
                }
                // Stop fleeing only when reaching safe distance (>15 units)
                else if (distanceToPlayer > this.safeRadius && this.isFleeing) {
                    this.isFleeing = false;
                    this.fleeCooldown = this.fleeCooldownDuration; // Start cooldown when stopping flee
                    this.pickRandomDirection();
                }
            }
        }

        // ========================================================================
        // FLEE MOVEMENT (if currently fleeing) - WITH COLLISION ESCAPE LOGIC
        // ========================================================================

        if (this.isFleeing && this.playerEntity) {
            const playerTransform = this.playerEntity.getComponentOfType(Transform);
            if (playerTransform) {
                const toPlayerX = playerTransform.translation[0] - transform.translation[0];
                const toPlayerZ = playerTransform.translation[2] - transform.translation[2];
                const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerZ * toPlayerZ);
                
                // Check if we've reached safe distance - stop fleeing and start cooldown
                if (distToPlayer > this.safeRadius) {
                    this.isFleeing = false;
                    this.fleeCooldown = this.fleeCooldownDuration; // Start 3-second cooldown
                    this.pickRandomDirection();
                    // Don't return - fall through to normal wandering behavior
                } else {
                    // === COLLISION-AWARE FLEE LOGIC ===
                    
                    // Update flee direction update timer
                    this.fleeDirectionUpdateTimer += dt;
                    this.fleeForceEscapeTimer += dt;
                    
                    // Force faster updates if timer expired
                    const updateNow = this.fleeDirectionUpdateTimer >= this.fleeDirectionUpdateInterval ||
                                     this.fleeForceEscapeTimer > 1.0;
                    
                    if (updateNow) {
                        this.fleeDirectionUpdateTimer = 0;
                        
                        // Check if sheep is stuck (barely moved since last check)
                        const movedX = transform.translation[0] - this.lastFleePosition[0];
                        const movedZ = transform.translation[2] - this.lastFleePosition[1];
                        const distanceMoved = Math.sqrt(movedX * movedX + movedZ * movedZ);
                        
                        // Sheep is stuck if minimal movement
                        const isStuck = distanceMoved < this.fleeStuckThreshold;
                        
                        if (isStuck) {
                            this.fleeStuckCounter++;
                            
                            // Immediate escape if stuck twice
                            if (this.fleeStuckCounter >= 2) {
                                // Perpendicular escape from stuck direction
                                const perpendicularOptions = [
                                    [-this.fleeDirection[1], this.fleeDirection[0]],  // 90° left
                                    [this.fleeDirection[1], -this.fleeDirection[0]],  // 90° right
                                ];
                                
                                // Pick perpendicular direction that's also away from player
                                let bestEscapeDir = perpendicularOptions[0];
                                let bestScore = -Infinity;
                                
                                for (const escapeDir of perpendicularOptions) {
                                    const awayScore = -(escapeDir[0] * toPlayerX + escapeDir[1] * toPlayerZ) / distToPlayer;
                                    if (awayScore > bestScore) {
                                        bestScore = awayScore;
                                        bestEscapeDir = escapeDir;
                                    }
                                }
                                
                                this.fleeDirection[0] = bestEscapeDir[0];
                                this.fleeDirection[1] = bestEscapeDir[1];
                                
                                this.fleeStuckCounter = 0;
                                this.fleeForceEscapeTimer = 0;
                            }
                        } else {
                            // Sheep moved successfully, reset stuck counter
                            this.fleeStuckCounter = 0;
                            this.fleeForceEscapeTimer = 0;
                            
                            // Normal flee direction update: away from player
                            if (distToPlayer > 0.01) {
                                const directAwayX = -toPlayerX / distToPlayer;
                                const directAwayZ = -toPlayerZ / distToPlayer;
                                
                                // Blend current direction with away direction (smooth steering)
                                const blendFactor = 0.4; // Increased responsiveness
                                this.fleeDirection[0] = this.fleeDirection[0] * (1 - blendFactor) + directAwayX * blendFactor;
                                this.fleeDirection[1] = this.fleeDirection[1] * (1 - blendFactor) + directAwayZ * blendFactor;
                                
                                // Normalize
                                const len = Math.sqrt(this.fleeDirection[0] ** 2 + this.fleeDirection[1] ** 2);
                                if (len > 0.01) {
                                    this.fleeDirection[0] /= len;
                                    this.fleeDirection[1] /= len;
                                }
                            }
                        }
                        
                        // Update last position for next stuck check
                        this.lastFleePosition[0] = transform.translation[0];
                        this.lastFleePosition[1] = transform.translation[2];
                    }
                    
                    // Use stored flee direction (not recalculated every frame)
                    let fleeX = this.fleeDirection[0];
                    let fleeZ = this.fleeDirection[1];
                    
                    // Ensure direction is normalized
                    const len = Math.sqrt(fleeX * fleeX + fleeZ * fleeZ);
                    if (len > 0.01) {
                        fleeX /= len;
                        fleeZ /= len;
                    } else {
                        // Fallback: pick random direction if somehow zero
                        const angle = Math.random() * Math.PI * 2;
                        fleeX = Math.sin(angle);
                        fleeZ = Math.cos(angle);
                    }
                    
                    // Move at flee speed
                    const fleeSpeed = this.moveSpeed * this.fleeSpeedMultiplier;
                    const oldPosX = transform.translation[0];
                    const oldPosZ = transform.translation[2];
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
                    const rotationLerpSpeed = this.rotationSpeed * 2.5 * dt;
                    const t = Math.min(rotationLerpSpeed, 1);
                    quat.slerp(transform.rotation, transform.rotation, targetRotation, t);
                    
                    // Apply boundary constraints
                    const hitWall = this.applyBoundaryConstraintsWithBounce(transform);
                    
                    // If we hit a wall, immediately adjust flee direction
                    if (hitWall) {
                        // Force immediate direction recalculation on next frame
                        this.fleeDirectionUpdateTimer = this.fleeDirectionUpdateInterval;
                        // Mark as potentially stuck
                        this.fleeStuckCounter++;
                    }
                    
                    return; // Skip wandering behavior
                }
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