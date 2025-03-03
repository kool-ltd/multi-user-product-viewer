import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { InteractionManager } from './InteractionManager.js';

// If using sockets, make sure to include your socket.io client library on the page.
const io = window.io;

class App {
    constructor() {
        this.loadedModels = new Map();
        this.draggableObjects = [];
        this.isARMode = false;
        this.socket = io();

        // Setup host/viewer roles via URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        this.isHost = urlParams.get('role') === 'host';

        // Create a loading overlay on the page.
        this.createLoadingOverlay();

        // Setup the loading manager.
        this.loadingManager = new THREE.LoadingManager(() => {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                overlay.style.display = 'none';
            }
        });

        this.loadingManager.onProgress = (url, loaded, total) => {
            const loadingText = document.getElementById('loading-text');
            if (loadingText) {
                loadingText.textContent = `Loading ${Math.round((loaded / total) * 100)}%`;
            }
        };

        // Create loaders with the loading manager.
        this.gltfLoader = new GLTFLoader(this.loadingManager);
        this.rgbeLoader = new RGBELoader(this.loadingManager);

        this.init();
        this.setupScene();
        this.setupLights();
        this.setupInitialControls();
        this.setupInterface();
        this.setupSocketListeners();

        // Create the interaction manager.
        this.interactionManager = new InteractionManager(
            this.scene,
            this.camera,
            this.renderer,
            this.renderer.domElement
        );

        if (this.isHost) {
            this.socket.emit('register-host');
        }

        this.animate();
    }

    setupSocketListeners() {
        // Host broadcasts camera and model updates.
        if (this.isHost) {
            this.orbitControls.addEventListener('change', () => {
                const cameraState = {
                    position: this.camera.position.toArray(),
                    rotation: this.camera.rotation.toArray(),
                    target: this.orbitControls.target.toArray()
                };
                this.socket.emit('camera-update', cameraState);
            });

            this.dragControls.addEventListener('drag', (event) => {
                const object = event.object;
                const modelState = {
                    id: object.uuid,
                    position: object.position.toArray(),
                    rotation: object.rotation.toArray(),
                    scale: object.scale.toArray()
                };
                this.socket.emit('model-transform', modelState);
            });
        }

        // Viewers receive updates.
        this.socket.on('camera-update', (cameraState) => {
            if (!this.isHost) {
                this.camera.position.fromArray(cameraState.position);
                this.camera.rotation.fromArray(cameraState.rotation);
                if (this.orbitControls) {
                    this.orbitControls.target.fromArray(cameraState.target);
                    this.orbitControls.update();
                }
            }
        });

        this.socket.on('model-transform', (modelState) => {
            if (!this.isHost) {
                const object = this.scene.getObjectByProperty('uuid', modelState.id);
                if (object) {
                    object.position.fromArray(modelState.position);
                    object.rotation.fromArray(modelState.rotation);
                    object.scale.fromArray(modelState.scale);
                }
            }
        });

        // AR mode synchronization.
        this.socket.on('ar-session-start', () => {
            if (!this.isHost) {
                this.scene.background = null;
            }
        });

        this.socket.on('ar-session-end', () => {
            if (!this.isHost) {
                this.scene.background = new THREE.Color(0xcccccc);
            }
        });

        // Model loading synchronization.
        this.socket.on('model-loaded', (modelData) => {
            if (!this.isHost) {
                this.loadModel(modelData.url, modelData.name);
            }
        });

        this.socket.on('models-cleared', () => {
            if (!this.isHost) {
                this.clearExistingModels();
            }
        });

        // State synchronization for new viewers.
        if (this.isHost) {
            this.socket.on('request-current-state', () => {
                const state = {
                    camera: {
                        position: this.camera.position.toArray(),
                        rotation: this.camera.rotation.toArray(),
                        target: this.orbitControls.target.toArray()
                    },
                    models: Array.from(this.loadedModels.entries()).map(([name, model]) => ({
                        name,
                        position: model.position.toArray(),
                        rotation: model.rotation.toArray(),
                        scale: model.scale.toArray()
                    }))
                };
                this.socket.emit('current-state', state);
            });
        } else {
            this.socket.emit('request-current-state');
        }

        this.socket.on('current-state', (state) => {
            if (!this.isHost) {
                this.camera.position.fromArray(state.camera.position);
                this.camera.rotation.fromArray(state.camera.rotation);
                if (this.orbitControls) {
                    this.orbitControls.target.fromArray(state.camera.target);
                    this.orbitControls.update();
                }

                state.models.forEach(modelState => {
                    const model = this.loadedModels.get(modelState.name);
                    if (model) {
                        model.position.fromArray(modelState.position);
                        model.rotation.fromArray(modelState.rotation);
                        model.scale.fromArray(modelState.scale);
                    }
                });
            }
        });
        
        // Handle viewer uploads.
        this.socket.on('viewer-upload', (modelData) => {
            fetch(modelData.data)
                .then(res => res.blob())
                .then(blob => {
                    const url = URL.createObjectURL(blob);
                    this.loadModel(url, modelData.name);
                });
        });
    }

    onWindowResize() {
        if (this.camera && this.renderer) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    init() {
        this.container = document.getElementById('scene-container');
        this.scene = new THREE.Scene();
        // Create a dedicated group for product parts.
        this.productGroup = new THREE.Group();
        this.scene.add(this.productGroup);

        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 0, 3);

        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.xr.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    setupScene() {
        this.scene.background = new THREE.Color(0xcccccc);

        this.rgbeLoader.load('https://raw.githubusercontent.com/kool-ltd/product-viewer/main/assets/brown_photostudio_02_4k.hdr', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            this.scene.environment = texture;
            
            this.renderer.physicallyCorrectLights = true;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 0.7;
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        });
    }

    setupLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);
    }

    setupARButton() {
        if ('xr' in navigator) {
            const arButton = ARButton.createButton(this.renderer, {
                requiredFeatures: ['hit-test'],
                optionalFeatures: ['dom-overlay'],
                domOverlay: { root: document.body }
            });
            document.body.appendChild(arButton);
    
            this.setupXRControllers();
    
            this.renderer.xr.addEventListener('sessionstart', () => {
                console.log("AR session started");
                this.isARMode = true;
                this.scene.background = null;
                this.renderer.setClearColor(0x000000, 0);
                if (this.isHost) {
                    this.socket.emit('ar-session-start');
                }
            });
    
            this.renderer.xr.addEventListener('sessionend', () => {
                console.log("AR session ended");
                this.isARMode = false;
                this.scene.background = new THREE.Color(0xcccccc);
                this.renderer.setClearColor(0xcccccc, 1);
                if (this.isHost) {
                    this.socket.emit('ar-session-end');
                }
            });
        }
    }

    setupInitialControls() {
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.dragControls = new DragControls(this.draggableObjects, this.camera, this.renderer.domElement);
        this.dragControls.enabled = true;
        this.setupControlsEventListeners();

        // Touch event listeners (if desired) can be added here—but let DragControls handle them.
        this.renderer.domElement.addEventListener('touchstart', (event) => {
            // No extra action needed; DragControls will take care of touch events.
        });
    }

    setupControlsEventListeners() {
        this.dragControls.addEventListener('dragstart', () => {
            this.orbitControls.enabled = false;
        });

        this.dragControls.addEventListener('dragend', () => {
            this.orbitControls.enabled = true;
        });
    }

    setupInterface() {
        const controlsContainer = document.createElement('div');
        controlsContainer.style.position = 'fixed';
        controlsContainer.style.top = '10px';
        controlsContainer.style.left = '10px';
        controlsContainer.style.zIndex = '1000';
        controlsContainer.style.display = 'flex';
        controlsContainer.style.gap = '10px';
        controlsContainer.style.alignItems = 'center';

        const roleIndicator = document.createElement('div');
        roleIndicator.style.padding = '5px 10px';
        roleIndicator.style.borderRadius = '4px';
        roleIndicator.style.backgroundColor = this.isHost ? '#4CAF50' : '#2196F3';
        roleIndicator.style.color = 'white';
        roleIndicator.style.fontSize = '14px';
        roleIndicator.textContent = this.isHost ? 'Host' : 'Viewer';
        controlsContainer.appendChild(roleIndicator);

        const uploadContainer = document.createElement('div');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.glb,.gltf';
        fileInput.style.display = 'none';
        fileInput.multiple = true;

        const uploadButton = document.createElement('button');
        uploadButton.textContent = 'Upload Model';
        uploadButton.style.padding = '10px';
        uploadButton.style.cursor = 'pointer';
        uploadButton.onclick = () => fileInput.click();

        fileInput.onchange = (event) => {
            this.clearExistingModels();
            const files = event.target.files;
            for (let file of files) {
                const url = URL.createObjectURL(file);
                const name = file.name.replace('.glb', '').replace('.gltf', '');
                this.loadModel(url, name);
                if (this.isHost) {
                    this.socket.emit('model-loaded', { url, name });
                }
            }
        };

        uploadContainer.appendChild(uploadButton);
        uploadContainer.appendChild(fileInput);
        controlsContainer.appendChild(uploadContainer);

        if ('xr' in navigator) {
            const arButton = ARButton.createButton(this.renderer, {
                requiredFeatures: ['hit-test'],
                optionalFeatures: ['dom-overlay'],
                domOverlay: { root: document.body }
            });
            arButton.style.position = 'fixed';
            controlsContainer.appendChild(arButton);
            
            this.renderer.xr.addEventListener('sessionstart', () => {
                this.isARMode = true;
                this.scene.background = null;
                this.renderer.setClearColor(0x000000, 0);
                if (this.isHost) {
                    this.socket.emit('ar-session-start');
                }
            });
    
            this.renderer.xr.addEventListener('sessionend', () => {
                this.isARMode = false;
                this.scene.background = new THREE.Color(0xcccccc);
                this.renderer.setClearColor(0xcccccc, 1);
                if (this.isHost) {
                    this.socket.emit('ar-session-end');
                }
            });
        }

        document.body.appendChild(controlsContainer);
    }
    
    clearExistingModels() {
        this.loadedModels.forEach(model => {
            // Remove from product group instead of the entire scene.
            this.productGroup.remove(model);
        });
        this.loadedModels.clear();
        this.draggableObjects.length = 0;
        this.updateDragControls();
        if (this.isHost) {
            this.socket.emit('models-cleared');
        }
    }

    loadModel(url, name) {
        this.gltfLoader.load(
            url, 
            (gltf) => {
                const model = gltf.scene;
                model.userData.isDraggable = true;
                model.traverse((child) => {
                    if (child !== model && child.isMesh) {
                        child.raycast = () => [];
                    }
                });

                // Add a custom raycast so the product container can be selected.
                model.raycast = function(raycaster, intersects) {
                    const box = new THREE.Box3().setFromObject(model);
                    if (!box.isEmpty()) {
                        const intersectionPoint = new THREE.Vector3();
                        if (raycaster.ray.intersectBox(box, intersectionPoint)) {
                            const distance = raycaster.ray.origin.distanceTo(intersectionPoint);
                            intersects.push({
                                distance: distance,
                                point: intersectionPoint.clone(),
                                object: model
                            });
                        }
                    }
                };

                this.draggableObjects.push(model);
                // Instead of adding the model directly to the scene,
                // add it to the dedicated productGroup.
                this.productGroup.add(model);
                this.loadedModels.set(name, model);
                this.updateDragControls();
                this.fitCameraToScene();

                if (this.isHost) {
                    this.socket.emit('model-loaded', { url, name });
                }

                console.log(`Loaded model: ${name}`);
            },
            (xhr) => {
                console.log(`${name} ${(xhr.loaded / xhr.total * 100)}% loaded`);
            },
            (error) => {
                console.error(`Error loading model ${name}:`, error);
            }
        );
    }

    updateDragControls() {
        const draggableObjects = Array.from(this.loadedModels.values());
        if (this.dragControls) {
            this.dragControls.dispose();
        }
        this.dragControls = new DragControls(draggableObjects, this.camera, this.renderer.domElement);
        this.setupControlsEventListeners();
    }

    fitCameraToScene() {
        // Compute the bounding box of the productGroup only.
        const box = new THREE.Box3().setFromObject(this.productGroup);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        
        // Adjust the camera distance [smaller multiplier zooms in].
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / Math.tan(fov / 2));
        cameraZ *= 1.2; // Reduced multiplier for a closer view
        
        // Reposition the camera so that it looks at the center of the product group.
        this.camera.position.set(center.x, center.y, center.z + cameraZ);
        this.orbitControls.target.copy(center);
        this.camera.updateProjectionMatrix();
        this.orbitControls.update();
    }

    loadDefaultModels() {
        const models = [
            { url: './assets/kool-mandoline-blade.glb', name: 'blade' },
            { url: './assets/kool-mandoline-frame.glb', name: 'frame' },
            { url: './assets/kool-mandoline-handguard.glb', name: 'handguard' },
            { url: './assets/kool-mandoline-handletpe.glb', name: 'handle' }
        ];
    
        // Clear existing models before loading defaults.
        this.clearExistingModels();
    
        models.forEach(model => {
            this.loadModel(model.url, model.name);
        });
    
        // After models load, update draggable objects in the interaction manager.
        setTimeout(() => {
            this.interactionManager.setDraggableObjects(Array.from(this.loadedModels.values()));
        }, 1000);
    }

    animate() {
        this.renderer.setAnimationLoop(() => {
            this.orbitControls.update();
            this.interactionManager.update();
            this.renderer.render(this.scene, this.camera);
        });
    }

    createLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = '#cccccc';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '9999';

        overlay.innerHTML = `
            <div id="loading-spinner" style="
                border: 11px solid #d00024; 
                border-top: 11px solid #f3f3f3; 
                border-radius: 50%; 
                width: 84px; 
                height: 84px; 
                animation: spin 2s linear infinite;
            "></div>
            <div id="loading-text" style="color: #333; margin-top: 20px; font-size: 14px; font-family: sans-serif;">
                Loading...
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
    }
}

const app = new App();
app.loadDefaultModels();

export default app;