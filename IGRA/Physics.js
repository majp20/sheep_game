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
                for (const other of this.scene) {
                    if (entity !== other && other.aabb) {
                        // Check collision with static entities
                        if (other.customProperties?.isStatic) {
                            const collided = this.resolveCollision(entity, other);
                        }
                        // Check collision with other dynamic entities (but only once per pair)
                        else if (other.customProperties?.isDynamic) {
                            // Only process each pair once by checking scene index
                            const entityIndex = this.scene.indexOf(entity);
                            const otherIndex = this.scene.indexOf(other);
                            if (entityIndex < otherIndex) {
                                // Debug: show transformed AABBs
                                const aBox = this.getTransformedAABB(entity);
                                const bBox = this.getTransformedAABB(other);
                                console.log('\nChecking dynamic pair:');
                                console.log('  A min:', `[${aBox.min[0].toFixed(2)}, ${aBox.min[1].toFixed(2)}, ${aBox.min[2].toFixed(2)}]`,
                                           'max:', `[${aBox.max[0].toFixed(2)}, ${aBox.max[1].toFixed(2)}, ${aBox.max[2].toFixed(2)}]`);
                                console.log('  B min:', `[${bBox.min[0].toFixed(2)}, ${bBox.min[1].toFixed(2)}, ${bBox.min[2].toFixed(2)}]`,
                                           'max:', `[${bBox.max[0].toFixed(2)}, ${bBox.max[1].toFixed(2)}, ${bBox.max[2].toFixed(2)}]`);
                                
                                const collided = this.resolveCollision(entity, other);
                                console.log('  Collision:', collided);
                                if (collided) {
                                    console.log('>>> Dynamic-Dynamic collision RESOLVED!');
                                }
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
        if (a.customProperties?.isDynamic && b.customProperties?.isDynamic) {
            console.log('Checking dynamic-dynamic collision:');
            console.log('  Entity A box:', aBox);
            console.log('  Entity B box:', bBox);
            console.log('  Is colliding:', isColliding);
        }
        
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

        vec3.add(transform.translation, transform.translation, minDirection);
        return true;
    }

}
