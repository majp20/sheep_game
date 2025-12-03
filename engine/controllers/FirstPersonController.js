import { quat, vec3, mat4 } from 'glm';

import { Transform } from '../core/Transform.js';
import { Camera } from '../core/Camera.js';

export class FirstPersonController {

    constructor(entity, domElement, {
        pitch = 0,
        yaw = 0,
        velocity = [0, 0, 0],
        acceleration = 50,
        maxSpeed = 5,
        decay = 0.99999,
        pointerSensitivity = 0.002,
        attack = false,
        distance = 10 //for sheep launching (reduced range - must get closer)

    } = {}) {
        this.entity = entity;
        this.domElement = domElement;

        this.keys = {};

        this.pitch = pitch;
        this.yaw = yaw;

        this.velocity = velocity;
        this.acceleration = acceleration;
        this.maxSpeed = maxSpeed;
        this.decay = decay;
        this.pointerSensitivity = pointerSensitivity;

        this.attack = attack;
        this.distance = distance;
        this.attackCooldown = 0; // Cooldown timer in seconds
        this.attackCooldownDuration = 1.3; 

        this.initHandlers();
    }

    initHandlers() {
        this.pointerclickHandler = this.pointerclickHandler.bind(this);
        this.pointermoveHandler = this.pointermoveHandler.bind(this);
        this.keydownHandler = this.keydownHandler.bind(this);
        this.keyupHandler = this.keyupHandler.bind(this);

        const element = this.domElement;
        const doc = element.ownerDocument;

        doc.addEventListener('keydown', this.keydownHandler);
        doc.addEventListener('keyup', this.keyupHandler);

        element.addEventListener('click', e => element.requestPointerLock());
        element.addEventListener('mousedown', this.pointerclickHandler);//after the mouse is already locked

        doc.addEventListener('pointerlockchange', e => {
            if (doc.pointerLockElement === element) {
                doc.addEventListener('pointermove', this.pointermoveHandler);
            } else {
                doc.removeEventListener('pointermove', this.pointermoveHandler);
                this.keys = {};
            }
        });
    }
    
    
    update(t, dt) {
        // Calculate forward and right vectors.
        const cos = Math.cos(this.yaw);
        const sin = Math.sin(this.yaw);
        const cosPitch = Math.cos(this.pitch);
        const sinPitch = Math.sin(this.pitch);
        
        // Forward vector for movement (horizontal only, no pitch)
        const forwardMove = [-sin, 0, -cos];
        const right = [cos, 0, -sin];
        
        // Forward vector for ray/looking (includes pitch for aiming)
        const forwardLook = [-sin * cosPitch, -sinPitch, -cos * cosPitch];

        
        // Map user input to the acceleration vector.
        const acc = vec3.create();
        if (this.keys['KeyW']) {
            vec3.add(acc, acc, forwardMove);
        }
        if (this.keys['KeyS']) {
            vec3.sub(acc, acc, forwardMove);
        }
        if (this.keys['KeyD']) {
            vec3.add(acc, acc, right);
        }
        if (this.keys['KeyA']) {
            vec3.sub(acc, acc, right);
        }
        
        // Update velocity based on acceleration.
        vec3.scaleAndAdd(this.velocity, this.velocity, acc, dt * this.acceleration);
        
        // If there is no user input, apply decay.
        if (!this.keys['KeyW'] &&
            !this.keys['KeyS'] &&
            !this.keys['KeyD'] &&
            !this.keys['KeyA'])
            {
                const decay = Math.exp(dt * Math.log(1 - this.decay));
                vec3.scale(this.velocity, this.velocity, decay);
        }
        
        // Limit speed to prevent accelerating to infinity and beyond.
        const speed = vec3.length(this.velocity);
        if (speed > this.maxSpeed) {
            vec3.scale(this.velocity, this.velocity, this.maxSpeed / speed);
        }
        
        const transform = this.entity.getComponentOfType(Transform);
        
        // Update attack cooldown
        if (this.attackCooldown > 0) {
            this.attackCooldown -= dt;
        }
        
        //for ray -> direction in which sheep will be launched
        if(this.attack && transform && this.attackCooldown <= 0) {
            // Ray originates from camera position
            const origin = vec3.clone(transform.translation);
            
            // Get camera component to access projection matrix
            const camera = this.entity.getComponentOfType(Camera);
            
            // Center of screen in NDC (Normalized Device Coordinates)
            const ndcX = 0.0; // center horizontal
            const ndcY = 0.0; // center vertical
            
            // Compute ray direction through center of screen
            // First, get view matrix (inverse of camera transform)
            const viewMatrix = mat4.create();
            mat4.fromRotationTranslation(viewMatrix, transform.rotation, transform.translation);
            mat4.invert(viewMatrix, viewMatrix);
            
            // Get projection matrix
            const projMatrix = camera ? camera.projectionMatrix : mat4.perspective(mat4.create(), 1.0, 1.0, 0.1, 100);
            
            // Compute inverse view-projection matrix
            const viewProjMatrix = mat4.create();
            mat4.multiply(viewProjMatrix, projMatrix, viewMatrix);
            const invViewProjMatrix = mat4.create();
            mat4.invert(invViewProjMatrix, viewProjMatrix);
            
            // Transform NDC point to world space (near plane)
            const nearPoint = vec3.fromValues(ndcX, ndcY, 0.0);
            vec3.transformMat4(nearPoint, nearPoint, invViewProjMatrix);
            
            // Transform NDC point to world space (far plane)
            const farPoint = vec3.fromValues(ndcX, ndcY, 1.0);
            vec3.transformMat4(farPoint, farPoint, invViewProjMatrix);
            
            // Ray direction from camera through screen center
            const direction = vec3.create();
            vec3.subtract(direction, farPoint, nearPoint);
            vec3.normalize(direction, direction);
            
            const rayEnd = vec3.create();
            vec3.scaleAndAdd(rayEnd, origin, direction, this.distance);
            
            // Raycast to find sheep to launch
            if (this.onRaycast) {
                this.onRaycast(origin, rayEnd, direction);
            }
            
            this.attack = false;
            this.attackCooldown = this.attackCooldownDuration; // Start cooldown
        } else if (this.attack && this.attackCooldown > 0) {
            this.attack = false;
        }


        if (transform) {
            // Update translation based on velocity.
            vec3.scaleAndAdd(transform.translation,
                transform.translation, this.velocity, dt);
                
            // Update rotation based on the Euler angles.
            const rotation = quat.create();
            quat.rotateY(rotation, rotation, this.yaw);
            quat.rotateX(rotation, rotation, this.pitch);
            transform.rotation = rotation;
        }
    }
    pointerclickHandler(e) {

        if (e.button !== 0) return; //left mouse button

        // Klik deluje samo ko je miš zaklenjena v canvas
        if (document.pointerLockElement !== this.domElement) return;

        // Check cooldown before allowing attack
        if (this.attackCooldown > 0) {
            return; // Still on cooldown, ignore click
        }

        // Označi udarec – update() ga bo kasneje obdelal
        this.attack = true;
    }

    pointermoveHandler(e) {
        const dx = e.movementX;
        const dy = e.movementY;

        this.pitch -= dy * this.pointerSensitivity;
        this.yaw   -= dx * this.pointerSensitivity;

        const twopi = Math.PI * 2;
        const halfpi = Math.PI / 2;

        this.pitch = Math.min(Math.max(this.pitch, -halfpi), halfpi);
        this.yaw = ((this.yaw % twopi) + twopi) % twopi;
    }

    keydownHandler(e) {
        this.keys[e.code] = true;
    }

    keyupHandler(e) {
        this.keys[e.code] = false;
    }

}
