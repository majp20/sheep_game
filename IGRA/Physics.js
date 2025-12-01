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
                            
                            // Skip collision with fence for sheep (check multiple ways)
                            const isSheep = sheepController !== undefined || entity.customProperties?.isSheep === true;
                            if (isSheep && other.customProperties?.isFence === true) {
                                continue;
                            }
                            
                            // Store position before collision
                            const transformBefore = entity.getComponentOfType(Transform);
                            const posBefore = transformBefore ? vec3.clone(transformBefore.translation) : null;
                            
                            // Invulnerable sheep still collide with static objects (walls/trees)
                            const collisionData = this.resolveCollision(entity, other);
                            
                            // If launched sheep hit static object, check if it was a real collision
                            if (collisionData && isLaunchedSheep && posBefore) {
                                const transformAfter = entity.getComponentOfType(Transform);
                                const posAfter = transformAfter.translation;
                                
                                // Calculate how much the sheep was pushed by collision
                                const pushDistance = vec3.distance(posBefore, posAfter);
                                
                                // Only stop launch if significantly pushed (real collision, not just AABB overlap)
                                if (pushDistance > 0.1) {
                                    sheepController.isLaunched = false;
                                    sheepController.launchVelocity = [0, 0, 0];
                                    const transform = entity.getComponentOfType(Transform);
                                    if (transform && sheepController.baseY !== null) {
                                        transform.translation[1] = sheepController.baseY;
                                    }
                                    sheepController.pickRandomDirection();
                                }
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
                                // Resolve collision between two dynamic entities
                                const collided = this.resolveCollision(entity, other);
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
        
        // Debug logging for dynamic-dynamic collisions
 
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
