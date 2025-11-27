import { quat, vec3, vec4, mat3, mat4 } from 'glm';

export function transformVertex(vertex, matrix,
    normalMatrix = mat3.normalFromMat4(mat3.create(), matrix),
    tangentMatrix = mat3.fromMat4(mat3.create(), matrix),
) {
    vec3.transformMat4(vertex.position, vertex.position, matrix);
    vec3.transformMat3(vertex.normal, vertex.normal, normalMatrix);
    vec3.transformMat3(vertex.tangent, vertex.tangent, tangentMatrix);
}

export function transformMesh(mesh, matrix,
    normalMatrix = mat3.normalFromMat4(mat3.create(), matrix),
    tangentMatrix = mat3.fromMat4(mat3.create(), matrix),
) {
    for (const vertex of mesh.vertices) {
        transformVertex(vertex, matrix, normalMatrix, tangentMatrix);
    }
}

export function calculateAxisAlignedBoundingBox(mesh) {
    if (!mesh || !mesh.vertices || mesh.vertices.length === 0) {
        throw new Error('calculateAxisAlignedBoundingBox: mesh or vertices are undefined/empty');
    }
    
    if (!mesh.vertices[0] || !mesh.vertices[0].position) {
        throw new Error('calculateAxisAlignedBoundingBox: first vertex or position is undefined');
    }
    
    const initial = {
        min: vec3.clone(mesh.vertices[0].position),
        max: vec3.clone(mesh.vertices[0].position),
    };

    return {
        min: mesh.vertices.reduce((a, b) => {
            if (!b || !b.position) {
                console.warn('Vertex with no position found, skipping');
                return a;
            }
            return vec3.min(a, a, b.position);
        }, initial.min),
        max: mesh.vertices.reduce((a, b) => {
            if (!b || !b.position) {
                console.warn('Vertex with no position found, skipping');
                return a;
            }
            return vec3.max(a, a, b.position);
        }, initial.max),
    };
}

export function mergeAxisAlignedBoundingBoxes(boxes) {
    // Validate input
    if (!boxes || boxes.length === 0) {
        throw new Error('mergeAxisAlignedBoundingBoxes: boxes array is empty or undefined');
    }
    
    // Validate all boxes
    for (let i = 0; i < boxes.length; i++) {
        if (!boxes[i] || !boxes[i].min || !boxes[i].max) {
            console.error(`Box at index ${i} is invalid:`, boxes[i]);
            throw new Error(`mergeAxisAlignedBoundingBoxes: box at index ${i} has undefined min or max`);
        }
    }
    
    const initial = {
        min: vec3.clone(boxes[0].min),
        max: vec3.clone(boxes[0].max),
    };

    return {
        min: boxes.reduce((amin, box) => vec3.min(amin, amin, box.min), initial.min),
        max: boxes.reduce((amax, box) => vec3.max(amax, amax, box.max), initial.max),
    };
}
