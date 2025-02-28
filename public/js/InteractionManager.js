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
        this.isARMode = false;
        this.selectedObject = null;
        this.activeController = null;
        this.lastControllerPosition = new THREE.Vector3();
        this.raycaster = new THREE.Raycaster();
        this.draggableObjects = [];
        
        this.setupOrbitControls();
        this.setupDragControls();
        this.setupAREvents();
        this.setupXRControllers();
        
        if (this.renderer) {
            this.renderer.xr.addEventListener('sessionstart', () => {
                console.log("XR session started");
                this.isARMode = true;
                
                // Make controllers visible in AR
                if (this.controller1) this.controller1.visible = true;
                if (this.controller2) this.controller2.visible = true;
                if (this.controllerGrip1) this.controllerGrip1.visible = true;
                if (this.controllerGrip2) this.controllerGrip2.visible = true;
            });
            
            this.renderer.xr.addEventListener('sessionend', () => {
                console.log("XR session ended");
                this.isARMode = false;
            });
        }
    }

    setupOrbitControls() {
        this.orbitControls = new OrbitControls(this.camera, this.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
    }

    setupDragControls() {
        this.dragControls = new DragControls(this.draggableObjects, this.camera, this.domElement);
        this.setupDragControlsEvents();
    }

    setupDragControlsEvents() {
        this.dragControls.addEventListener('dragstart', () => {
            this.orbitControls.enabled = false;
        });

        this.dragControls.addEventListener('dragend', () => {
            this.orbitControls.enabled = true;
        });

        this.dragControls.addEventListener('drag', (event) => {
            // Prevent scaling during drag
            const object = event.object;
            if (object.userData.originalScale) {
                object.scale.copy(object.userData.originalScale);
            }
        });
    }

    setupAREvents() {
        this.domElement.addEventListener('touchstart', (event) => {
            if (!this.isARMode) return;
            
            event.preventDefault();
            
            const touch = event.touches[0];
            const mouse = new THREE.Vector2();
            
            mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
            
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);
            
            const intersects = raycaster.intersectObjects(this.draggableObjects, true);
            console.log("AR touchstart intersects:", intersects.length);
            
            if (intersects.length > 0) {
                const selectedObject = intersects[0].object;
                let targetObject = selectedObject;
                
                while (targetObject.parent && targetObject.parent !== this.scene) {
                    targetObject = targetObject.parent;
                }
                
                this.selectedObject = targetObject;
                this.initialTouchX = touch.clientX;
                this.initialTouchY = touch.clientY;
                this.initialObjectPosition = targetObject.position.clone();
                console.log("Selected object in AR:", targetObject.name || targetObject.uuid);
            }
        });

        this.domElement.addEventListener('touchmove', (event) => {
            if (!this.isARMode || !this.selectedObject) return;
            
            event.preventDefault();
            
            const touch = event.touches[0];
            const deltaX = (touch.clientX - this.initialTouchX) * 0.01;
            const deltaY = (touch.clientY - this.initialTouchY) * 0.01;
            
            const cameraRight = new THREE.Vector3();
            const cameraUp = new THREE.Vector3();
            this.camera.getWorldDirection(cameraRight);
            cameraRight.cross(this.camera.up).normalize();
            cameraUp.copy(this.camera.up);
            
            this.selectedObject.position.copy(this.initialObjectPosition);
            this.selectedObject.position.add(cameraRight.multiplyScalar(-deltaX));
            this.selectedObject.position.add(cameraUp.multiplyScalar(-deltaY));
        });

        this.domElement.addEventListener('touchend', () => {
            if (!this.isARMode) return;
            this.selectedObject = null;
        });
    }

    setupXRControllers() {
        if (!this.renderer) return;
        
        console.log("Setting up XR controllers");
        
        // Create controller rays for visualization
        const rayGeometry = new THREE.BufferGeometry();
        rayGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -10], 3));
        
        const rayMaterial = new THREE.LineBasicMaterial({
            color: 0xFF0000,  // Red for visibility
            linewidth: 5
        });
        
        // Create grip/controller model factory
        const controllerModelFactory = new XRControllerModelFactory();
        
        // Controller 1 (right hand)
        this.controller1 = this.renderer.xr.getController(0);
        this.controller1.name = "controller-right";
        this.scene.add(this.controller1);
        
        // Add visible ray
        const controllerRay1 = new THREE.Line(rayGeometry, rayMaterial);
        controllerRay1.name = "controller-ray";
        this.controller1.add(controllerRay1);
        
        // Add grip model
        this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
        this.controllerGrip1.add(controllerModelFactory.createControllerModel(this.controllerGrip1));
        this.scene.add(this.controllerGrip1);
        
        // Controller 2 (left hand)
        this.controller2 = this.renderer.xr.getController(1);
        this.controller2.name = "controller-left";
        this.scene.add(this.controller2);
        
        // Add visible ray
        const controllerRay2 = new THREE.Line(rayGeometry, rayMaterial);
        controllerRay2.name = "controller-ray";
        this.controller2.add(controllerRay2);
        
        // Add grip model
        this.controllerGrip2 = this.renderer.xr.getControllerGrip(1);
        this.controllerGrip2.add(controllerModelFactory.createControllerModel(this.controllerGrip2));
        this.scene.add(this.controllerGrip2);
        
        // Add controller event listeners
        this.controller1.addEventListener('selectstart', this.onControllerSelectStart.bind(this));
        this.controller1.addEventListener('selectend', this.onControllerSelectEnd.bind(this));
        this.controller2.addEventListener('selectstart', this.onControllerSelectStart.bind(this));
        this.controller2.addEventListener('selectend', this.onControllerSelectEnd.bind(this));
        
        console.log("XR controllers initialized");
    }
    
    onControllerSelectStart(event) {
        if (!this.isARMode) return;
        
        console.log("Controller select start");
        const controller = event.target;
        
        // Setup raycaster from controller
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(controller.matrixWorld);
        
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
        
        // Find intersected objects
        const intersects = this.raycaster.intersectObjects(this.draggableObjects, true);
        console.log("Intersected objects:", intersects.length);
        
        if (intersects.length > 0) {
            let targetObject = intersects[0].object;
            
            // Find the top-level model parent
            while (targetObject.parent && targetObject.parent !== this.scene) {
                targetObject = targetObject.parent;
            }
            
            console.log("Selected object:", targetObject.name || targetObject.uuid);
            this.selectedObject = targetObject;
            this.activeController = controller;
            this.lastControllerPosition = new THREE.Vector3();
            this.lastControllerPosition.setFromMatrixPosition(controller.matrixWorld);
            
            // Visual feedback (optional)
            targetObject.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.userData.originalMaterial = child.material;
                    child.material = child.material.clone();
                    child.material.emissive = new THREE.Color(0x333333);
                }
            });
        }
    }
    
    onControllerSelectEnd() {
        if (!this.isARMode) return;
        
        console.log("Controller select end");
        
        if (this.selectedObject) {
            // Restore original materials if we changed them
            this.selectedObject.traverse((child) => {
                if (child.isMesh && child.userData.originalMaterial) {
                    child.material = child.userData.originalMaterial;
                    delete child.userData.originalMaterial;
                }
            });
        }
        
        this.selectedObject = null;
        this.activeController = null;
    }

    setDraggableObjects(objects) {
        this.draggableObjects = objects;
        this.dragControls.dispose();
        this.dragControls = new DragControls(objects, this.camera, this.domElement);
        this.setupDragControlsEvents();
    }

    update() {
        // Handle controller-based object movement
        if (this.selectedObject && this.activeController && this.isARMode) {
            // Get current controller position
            const currentPosition = new THREE.Vector3();
            currentPosition.setFromMatrixPosition(this.activeController.matrixWorld);
            
            // Calculate movement delta
            const delta = new THREE.Vector3().subVectors(
                currentPosition, 
                this.lastControllerPosition
            );
            
            // Apply movement to the selected object
            this.selectedObject.position.add(delta);
            
            // Update last position
            this.lastControllerPosition.copy(currentPosition);
        }
        
        // Update orbit controls if not in AR mode
        if (this.orbitControls && !this.isARMode) {
            this.orbitControls.update();
        }
    }
    
    onXRSessionStart() {
        this.isARMode = true;
        console.log("XR session started from interaction manager");
    }
    
    onXRSessionEnd() {
        this.isARMode = false;
        console.log("XR session ended from interaction manager");
    }
}