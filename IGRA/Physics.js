import { vec3, mat4 } from 'glm';
import { getGlobalModelMatrix } from 'engine/core/SceneUtils.js';
import { Transform } from 'engine/core/core.js';

export class Physics {

    constructor(scene) {
        this.scene = scene;
    }

    update(t, dt) {
        for (const entity of this.scene) {
            if (entity.customProperties?.isDynamic && entity.aabb) {
                // Check if this is a launched sheep
                const sheepController = entity.components?.find(c => c.constructor.name === 'SheepController');
                const isLaunchedSheep = sheepController?.isLaunched;
                const isInvulnerable = sheepController?.launchInvulnerable;
                
                for (const other of this.scene) {
                    if (entity !== other && other.aabb) {
                        // Check if the OTHER entity is invulnerable (skip collision with it)
                        const otherController = other.components?.find(c => c.constructor.name === 'SheepController');
                        const otherInvulnerable = otherController?.launchInvulnerable;
                        
                        // Skip collision WITH invulnerable sheep (so others don't get pushed)
                        if (otherInvulnerable) {
                            continue;
                        }
                        
                        // Check collision with static entities
                        if (other.customProperties?.isStatic) {
                            // Skip collision with camera/player (has no mesh)
                            if (!other.aabb.min || !other.aabb.max) {
                                continue;
                            }
                            
                            // Check if sheep stepped on seno (hay)
                            const isSheep = sheepController !== undefined || entity.customProperties?.isSheep === true;
                            if (isSheep && other.customProperties?.isSeno) {
                                const sheepAABB = this.getTransformedAABB(entity);
                                const senoAABB = this.getTransformedAABB(other);
                                
                                // Check 2D overlap on XZ plane (ignore Y axis since seno is flat)
                                const xOverlap = sheepAABB.min[0] <= senoAABB.max[0] && sheepAABB.max[0] >= senoAABB.min[0];
                                const zOverlap = sheepAABB.min[2] <= senoAABB.max[2] && sheepAABB.max[2] >= senoAABB.min[2];
                                
                                // Check if sheep is on or near the ground (within 1 unit of seno Y level)
                                const yNearGround = sheepAABB.min[1] <= senoAABB.max[1] + 1.0;
                                
                                const isOnSeno = xOverlap && zOverlap && yNearGround;
                                
                                if (isOnSeno) {
                                    // Mark sheep as being on seno and store seno boundaries
                                    if (sheepController) {
                                        sheepController.isOnSeno = true;
                                        sheepController.senoBounds = {
                                            min: [senoAABB.min[0], senoAABB.min[2]],
                                            max: [senoAABB.max[0], senoAABB.max[2]]
                                        };
                                        
                                        // Cancel panic/flee/launch states when entering seno
                                        sheepController.isLaunched = false;
                                        sheepController.isPanic = false;
                                        sheepController.isFleeing = false;
                                        sheepController.launchVelocity = [0, 0, 0];
                                    }
                                    // Skip collision so sheep don't get pushed off
                                    continue;
                                }
                            }
                            
                            // Store position before collision
                            const transformBefore = entity.getComponentOfType(Transform);
                            const posBefore = transformBefore ? vec3.clone(transformBefore.translation) : null;
                            
                            // Invulnerable sheep still collide with static objects (walls/trees)
                            // For fast-moving entities, check intermediate positions to prevent clipping
                            let collisionData = false;
                            if (posBefore) {
                                const currentPos = transformBefore.translation;
                                const moveDistance = vec3.distance(posBefore, currentPos);
                                
                                // If entity moved far in one frame, use swept collision detection
                                if (moveDistance > 2.0) {
                                    // Check collision at intermediate positions
                                    const steps = Math.ceil(moveDistance / 2.0);
                                    for (let i = 0; i <= steps; i++) {
                                        const t = i / steps;
                                        const intermediatePos = vec3.create();
                                        vec3.lerp(intermediatePos, posBefore, currentPos, t);
                                        
                                        // Temporarily set position to check collision
                                        const originalPos = vec3.clone(transformBefore.translation);
                                        vec3.copy(transformBefore.translation, intermediatePos);
                                        
                                        if (this.resolveCollision(entity, other)) {
                                            collisionData = true;
                                            break; // Stop at first collision
                                        }
                                        
                                        // Restore position if no collision at this step
                                        vec3.copy(transformBefore.translation, originalPos);
                                    }
                                } else {
                                    // Normal collision check for slow movement
                                    collisionData = this.resolveCollision(entity, other);
                                }
                            } else {
                                collisionData = this.resolveCollision(entity, other);
                            }
                            
                            // If launched sheep hit static object, stop launch
                            if (collisionData && isLaunchedSheep) {
                                sheepController.isLaunched = false;
                                sheepController.launchVelocity = [0, 0, 0];
                                const transform = entity.getComponentOfType(Transform);
                                if (transform && sheepController.baseY !== null) {
                                    transform.translation[1] = sheepController.baseY;
                                }
                                sheepController.pickRandomDirection();
                            }
                        }
                        // Check collision with other dynamic entities (but only once per pair)
                        else if (other.customProperties?.isDynamic) {
                            // Skip sheep-sheep collisions if either is invulnerable
                            if (isInvulnerable) {
                                continue;
                            }
                            
                            // Only process each pair once by checking scene index
                            const entityIndex = this.scene.indexOf(entity);
                            const otherIndex = this.scene.indexOf(other);
                            if (entityIndex < otherIndex) {
                                // Check if both sheep are on seno - if so, they can still collide with each other
                                const isEntityOnSeno = sheepController?.isOnSeno;
                                const isOtherOnSeno = otherController?.isOnSeno;
                                
                                // Allow collision unless one is on seno and the other is not
                                // (prevents normal sheep from pushing seno sheep, but allows seno sheep to collide with each other)
                                const shouldCollide = (isEntityOnSeno && isOtherOnSeno) || (!isEntityOnSeno && !isOtherOnSeno);
                                
                                if (shouldCollide) {
                                    // Resolve collision between two dynamic entities
                                    const collided = this.resolveCollision(entity, other);
                                }
                                // Launched sheep don't stop on sheep collision (phase through during invulnerability)
                                // They only stop when hitting walls or landing
                            }
                        }
                    }
                }
            }
        }
    }
    
    calculateCorrectionVector(aBox, bBox) {
        // Calculate minimal correction to separate the boxes
        const diffa = vec3.sub(vec3.create(), bBox.max, aBox.min);
        const diffb = vec3.sub(vec3.create(), aBox.max, bBox.min);

        let minDiff = Infinity;
        let minDirection = [0, 0, 0];
        
        if (diffa[0] >= 0 && diffa[0] < minDiff) {
            minDiff = diffa[0];
            minDirection = [minDiff, 0, 0];
        }
        if (diffa[1] >= 0 && diffa[1] < minDiff) {
            minDiff = diffa[1];
            minDirection = [0, minDiff, 0];
        }
        if (diffa[2] >= 0 && diffa[2] < minDiff) {
            minDiff = diffa[2];
            minDirection = [0, 0, minDiff];
        }
        if (diffb[0] >= 0 && diffb[0] < minDiff) {
            minDiff = diffb[0];
            minDirection = [-minDiff, 0, 0];
        }
        if (diffb[1] >= 0 && diffb[1] < minDiff) {
            minDiff = diffb[1];
            minDirection = [0, -minDiff, 0];
        }
        if (diffb[2] >= 0 && diffb[2] < minDiff) {
            minDiff = diffb[2];
            minDirection = [0, 0, -minDiff];
        }
        
        return minDirection;
    }

    intervalIntersection(min1, max1, min2, max2) {
        return !(min1 > max2 || min2 > max1);
    }

    aabbIntersection(aabb1, aabb2) {
        return this.intervalIntersection(aabb1.min[0], aabb1.max[0], aabb2.min[0], aabb2.max[0])
            && this.intervalIntersection(aabb1.min[1], aabb1.max[1], aabb2.min[1], aabb2.max[1])
            && this.intervalIntersection(aabb1.min[2], aabb1.max[2], aabb2.min[2], aabb2.max[2]);
    }

    getTransformedAABB(entity) {
        // Transform all vertices of the AABB from local to global space.
        const matrix = getGlobalModelMatrix(entity);
        const { min, max } = entity.aabb;
        const vertices = [
            [min[0], min[1], min[2]],
            [min[0], min[1], max[2]],
            [min[0], max[1], min[2]],
            [min[0], max[1], max[2]],
            [max[0], min[1], min[2]],
            [max[0], min[1], max[2]],
            [max[0], max[1], min[2]],
            [max[0], max[1], max[2]],
        ].map(v => vec3.transformMat4(v, v, matrix));

        // Find new min and max by component.
        const xs = vertices.map(v => v[0]);
        const ys = vertices.map(v => v[1]);
        const zs = vertices.map(v => v[2]);
        const newmin = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
        const newmax = [Math.max(...xs), Math.max(...ys), Math.max(...zs)];
        return { min: newmin, max: newmax };
    }

    resolveCollision(a, b) {
        // Get global space AABBs.
        const aBox = this.getTransformedAABB(a);
        const bBox = this.getTransformedAABB(b);

        // Check if there is collision.
        const isColliding = this.aabbIntersection(aBox, bBox);   
 
        if (!isColliding) {
            return false;
        }

        // Move entity A minimally to avoid collision.
        const diffa = vec3.sub(vec3.create(), bBox.max, aBox.min);
        const diffb = vec3.sub(vec3.create(), aBox.max, bBox.min);

        let minDiff = Infinity;
        let minDirection = [0, 0, 0];
        if (diffa[0] >= 0 && diffa[0] < minDiff) {
            minDiff = diffa[0];
            minDirection = [minDiff, 0, 0];
        }
        if (diffa[1] >= 0 && diffa[1] < minDiff) {
            minDiff = diffa[1];
            minDirection = [0, minDiff, 0];
        }
        if (diffa[2] >= 0 && diffa[2] < minDiff) {
            minDiff = diffa[2];
            minDirection = [0, 0, minDiff];
        }
        if (diffb[0] >= 0 && diffb[0] < minDiff) {
            minDiff = diffb[0];
            minDirection = [-minDiff, 0, 0];
        }
        if (diffb[1] >= 0 && diffb[1] < minDiff) {
            minDiff = diffb[1];
            minDirection = [0, -minDiff, 0];
        }
        if (diffb[2] >= 0 && diffb[2] < minDiff) {
            minDiff = diffb[2];
            minDirection = [0, 0, -minDiff];
        }

        const transform = a.getComponentOfType(Transform);
        if (!transform) {
            return false;
        }

        // Store original Y position to prevent vertical displacement
        const originalY = transform.translation[1];
        
        vec3.add(transform.translation, transform.translation, minDirection);
        
        // Lock Y-axis for entities (prevents floating/sinking)
        // Only apply X and Z corrections
        transform.translation[1] = originalY;
        
        return true;
    }

}
