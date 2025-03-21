import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

export class InteractionManager {
    constructor(scene, camera, renderer, domElement) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.domElement = domElement;

        // Flag for XR session (AR or VR)
        this.isXRSessionActive = false;
        // Flag for whether rotation mode is active (when squeeze is pressed)
        this.rotationMode = false;
        // To store the controller's quaternion and object's quaternion at the start of a rotation
        this.startControllerQuaternion = new THREE.Quaternion();
        this.startObjectQuaternion = new THREE.Quaternion();

        this.selectedObject = null;
        this.activeController = null;
        this.lastControllerPosition = new THREE.Vector3();
        this.raycaster = new THREE.Raycaster();
        this.draggableObjects = [];

        this.setupOrbitControls();
        this.setupDragControls();
        this.setupXRControllers();
        
        if (this.renderer) {
            // Listen for session start/end events.
            this.renderer.xr.addEventListener('sessionstart', () => {
                console.log("XR session started");
                this.isXRSessionActive = true;
                // Ensure controllers are visible when XR is active.
                if (this.controller1) this.controller1.visible = true;
                if (this.controller2) this.controller2.visible = true;
                if (this.controllerGrip1) this.controllerGrip1.visible = true;
                if (this.controllerGrip2) this.controllerGrip2.visible = true;
            });
            
            this.renderer.xr.addEventListener('sessionend', () => {
                console.log("XR session ended");
                this.isXRSessionActive = false;
                this.rotationMode = false; // End any rotation mode.
            });
        }
    }

    setupOrbitControls() {
        this.orbitControls = new OrbitControls(this.camera, this.domElement);
        this.orbitControls.rotateSpeed = 0.01;
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
    }

    setupDragControls() {
        this.dragControls = new DragControls(this.draggableObjects, this.camera, this.domElement);
        this.setupDragControlsEvents();
    }

    setupDragControlsEvents() {
        this.dragControls.addEventListener('dragstart', () => {
            // Disable orbit controls so that the viewport remains fixed during drag.
            this.orbitControls.enabled = false;
        });

        this.dragControls.addEventListener('dragend', () => {
            // Re-enable orbit controls once dragging ends.
            this.orbitControls.enabled = true;
        });

        this.dragControls.addEventListener('drag', (event) => {
            // Ensure the object's scale remains its original scale during dragging.
            const object = event.object;
            if (object.userData.originalScale) {
                object.scale.copy(object.userData.originalScale);
            }
        });
    }

    setupXRControllers() {
        if (!this.renderer) return;
        
        console.log("Setting up XR controllers");
        
        // Create visible controller rays.
        const rayGeometry = new THREE.BufferGeometry();
        rayGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -10], 3));
        
        const rayMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            // Note: linewidth isn’t widely supported.
        });
        
        const controllerModelFactory = new XRControllerModelFactory();
        
        // Controller 1 (right hand)
        this.controller1 = this.renderer.xr.getController(0);
        this.controller1.name = "controller-right";
        this.scene.add(this.controller1);
        const controllerRay1 = new THREE.Line(rayGeometry, rayMaterial);
        controllerRay1.name = "controller-ray";
        this.controller1.add(controllerRay1);
        this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
        this.controllerGrip1.add(controllerModelFactory.createControllerModel(this.controllerGrip1));
        this.scene.add(this.controllerGrip1);
        
        // Controller 2 (left hand)
        this.controller2 = this.renderer.xr.getController(1);
        this.controller2.name = "controller-left";
        this.scene.add(this.controller2);
        const controllerRay2 = new THREE.Line(rayGeometry, rayMaterial);
        controllerRay2.name = "controller-ray";
        this.controller2.add(controllerRay2);
        this.controllerGrip2 = this.renderer.xr.getControllerGrip(1);
        this.controllerGrip2.add(controllerModelFactory.createControllerModel(this.controllerGrip2));
        this.scene.add(this.controllerGrip2);
        
        // Set up controller event listeners for selection.
        this.controller1.addEventListener('selectstart', this.onControllerSelectStart.bind(this));
        this.controller1.addEventListener('selectend', this.onControllerSelectEnd.bind(this));
        this.controller2.addEventListener('selectstart', this.onControllerSelectStart.bind(this));
        this.controller2.addEventListener('selectend', this.onControllerSelectEnd.bind(this));
        
        // Set up squeeze event listeners for rotation.
        this.controller1.addEventListener('squeezestart', this.onControllerSqueezeStart.bind(this));
        this.controller1.addEventListener('squeezeend', this.onControllerSqueezeEnd.bind(this));
        this.controller2.addEventListener('squeezestart', this.onControllerSqueezeStart.bind(this));
        this.controller2.addEventListener('squeezeend', this.onControllerSqueezeEnd.bind(this));

        console.log("XR controllers initialized");
    }
    
    onControllerSelectStart(event) {
        const controller = event.target;
        console.log("Controller select start");
        
        // Configure the raycaster based on the controller's current orientation.
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(controller.matrixWorld);
        
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
        
        const intersects = this.raycaster.intersectObjects(this.draggableObjects, true);
        console.log("Intersected objects:", intersects.length);
        
        if (intersects.length > 0) {
            let targetObject = intersects[0].object;
            // Traverse upward to find the parent product container.
            while (targetObject.parent && targetObject.parent !== this.scene) {
                targetObject = targetObject.parent;
            }
            
            console.log("Selected object:", targetObject.name || targetObject.uuid);
            this.selectedObject = targetObject;
            this.activeController = controller;
            this.lastControllerPosition.setFromMatrixPosition(controller.matrixWorld);
        }
    }
    
    onControllerSelectEnd() {
        console.log("Controller select end");
        this.selectedObject = null;
        this.activeController = null;
        this.rotationMode = false; // End any active rotation.
    }

    // Rotation event handlers.
    onControllerSqueezeStart(event) {
        const controller = event.target;
        console.log("Squeeze start");
        // Only enable rotation mode if an object is already selected.
        if (this.selectedObject) {
            this.rotationMode = true;
            // Save the starting orientations.
            this.startControllerQuaternion.copy(controller.quaternion);
            this.startObjectQuaternion.copy(this.selectedObject.quaternion);
        }
    }

    onControllerSqueezeEnd(event) {
        console.log("Squeeze end");
        this.rotationMode = false;
    }

    setDraggableObjects(objects) {
        this.draggableObjects = objects;
        this.dragControls.dispose();
        this.dragControls = new DragControls(objects, this.camera, this.domElement);
        this.setupDragControlsEvents();
    }

    update() {
        if (this.selectedObject && this.activeController && this.isXRSessionActive) {
            if (this.rotationMode) {
                // Update object's rotation based on the change in controller's orientation.
                const currentControllerQuaternion = this.activeController.quaternion;
                const deltaQuaternion = currentControllerQuaternion.clone();
                deltaQuaternion.multiply(this.startControllerQuaternion.clone().invert());
                const newObjectQuaternion = deltaQuaternion.multiply(this.startObjectQuaternion);
                this.selectedObject.quaternion.copy(newObjectQuaternion);
            } else {
                // Update position by computing difference between current and last controller positions.
                const currentPosition = new THREE.Vector3();
                currentPosition.setFromMatrixPosition(this.activeController.matrixWorld);
                let delta = new THREE.Vector3().subVectors(currentPosition, this.lastControllerPosition);
                
                // Optionally increase sensitivity on mobile devices.
                if (navigator.userAgent.match(/Mobi/)) {
                    delta.multiplyScalar(2.0);
                }
                
                this.selectedObject.position.add(delta);
                this.lastControllerPosition.copy(currentPosition);
            }
        }
        
        // Ensure orbit controls are updated when not in XR session.
        if (this.orbitControls && !this.isXRSessionActive) {
            this.orbitControls.update();
        }
    }
    
    onXRSessionStart() {
        this.isXRSessionActive = true;
        console.log("XR session started from interaction manager");
    }
    
    onXRSessionEnd() {
        this.isXRSessionActive = false;
        console.log("XR session ended from interaction manager");
    }
}
