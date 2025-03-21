import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { InteractionManager } from './InteractionManager.js';
import { setupUIControls, updateToggleUI } from './uiControls.js';
import { showHostRequestModal, showConfirmationModal } from './modalManager.js';

// Ensure your socket.io client library is loaded.
const io = window.io;

class App {
  constructor() {
    // ----- Shared Variables -----
    this.loadedModels = new Map();
    this.draggableObjects = [];
    this.isARMode = false;
    this.isPlacingProduct = false;
    // For host pointer updates (from version 1)
    this.pointerNDC = new THREE.Vector2(0, 0);
    // For now we set pointerActive to true (you can update this flag based on your UX)
    this.pointerActive = true;
    this.isDragging = false;
    // For handling two-finger pan/rotation gesture (version 2)
    this.lastTouchAngle = null;
    // Determine host status via query params (if role=host, then true)
    this.isHost = new URLSearchParams(window.location.search).get('role') === 'host';
    
    // Variables for AR tap‑to‑place integration (version 2)
    this.placementReticle = null;
    this.placementMessage = null;
    this.placeAgainButton = null;
    this.hitTestSource = null;
    // Variable for host pointer (from version 1)
    this.hostPointer = null;
    
    // Socket initialization. In both versions the host registers itself.
    this.socket = io();
    if (this.isHost) {
      this.socket.emit('register-host');
    }
    
    // Create overlays: loading overlay (for product/model loading) and upload overlay (version 1)
    this.createLoadingOverlay();
    this.createUploadOverlay();

    // Set up THREE.LoadingManager (progress updates are no longer displayed).
    this.loadingManager = new THREE.LoadingManager(() => {});
    this.loadingManager.onProgress = (url, loaded, total) => {};
    
    this.gltfLoader = new GLTFLoader(this.loadingManager);
    this.rgbeLoader = new RGBELoader(this.loadingManager);

    this.init();
    this.setupScene();
    this.setupLights();
    this.setupInitialControls();

    // Set up UI toggles (if any)
    setupUIControls(this);

    // --- File Upload Handling ---
    // The file input is created in uiControls.js.
    const fileInput = document.querySelector('input[type="file"][accept=".glb,.gltf"]');
    if (fileInput) {
      fileInput.onchange = async (event) => {
        // Show the loading overlay at the start of upload.
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
  
        const files = event.target.files;
        if (!files || files.length === 0) {
          if (loadingOverlay) loadingOverlay.style.display = 'none';
          return;
        }
  
        this.clearExistingModels();
  
        for (let file of files) {
          const formData = new FormData();
          formData.append('model', file);
          try {
            const response = await fetch('/upload', {
              method: 'POST',
              headers: {
                'x-socket-id': this.socket.id,
                'x-uploader-role': this.isHost ? 'host' : 'viewer'
              },
              body: formData
            });
            if (response.ok) {
              const data = await response.json();
              if (!this.isHost) {
                const name = data.name.replace('.glb', '').replace('.gltf', '');
                await this.loadModel(data.url, name);
              }
            } else {
              console.error("Upload failed:", response.statusText);
            }
          } catch (error) {
            console.error("File upload error:", error);
          }
        }
        if (this.isHost) {
          if (this._productUploadCompleteTimeout) {
            clearTimeout(this._productUploadCompleteTimeout);
          }
          this._productUploadCompleteTimeout = setTimeout(() => {
            this.socket.emit('product-upload-complete');
            this._productUploadCompleteTimeout = null;
            if (loadingOverlay) loadingOverlay.style.display = 'none';
          }, 500);
        } else {
          if (loadingOverlay) loadingOverlay.style.display = 'none';
        }
      };
    }

    // Set up socket communication.
    this.setupSocketListeners();

    // Create an InteractionManager instance.
    this.interactionManager = new InteractionManager(
      this.scene,
      this.camera,
      this.renderer,
      this.renderer.domElement
    );

    // Listen for pointer movement (to update host pointer in non‐AR mode)
    window.addEventListener('pointermove', this.handlePointerMove.bind(this));

    // AR session start listener for tap‑to‑place integration (version 2)
    this.renderer.xr.addEventListener('sessionstart', this.onARSessionStart.bind(this));

    // Two‑finger touch event listeners for rotation (version 2)
    this.renderer.domElement.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
    this.renderer.domElement.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    this.renderer.domElement.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });

    // Instead of directly loading the default product, show the landing overlay.
    this.showLandingOverlay();

    this.animate();
  }

  // -----------------------------------------------------------------------------
  // Landing Overlay – Demo / Upload / Browse Options
  // -----------------------------------------------------------------------------
  showLandingOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'landing-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = '#cccccc';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '10000';

    const box = document.createElement('div');
    box.style.backgroundColor = 'white';
    box.style.padding = '30px';
    box.style.borderRadius = '8px';
    box.style.textAlign = 'center';
    box.style.width = '300px';

    const title = document.createElement('h1');
    title.style.margin = '0 0 10px';
    title.innerHTML = 'SyncVision <span style="font-size: 16px; font-weight: normal;">by kool</span>';

    const description = document.createElement('p');
    description.style.fontSize = '14px';
    description.style.color = '#333';
    description.style.marginBottom = '20px';
    description.innerHTML = '<p> Click the Browse button to browse existing files, or Upload button to upload GLB files to view new ideas.</p> <p>Experience interactive product development like never before!</p> <p style="font-size: 12px;">(pending name &amp; content)</p>';
    
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.justifyContent = 'space-around';

    // const demoButton = document.createElement('button');
    // demoButton.textContent = 'Demo';
    // demoButton.style.backgroundColor = '#d00024';
    // demoButton.style.color = 'white';
    // demoButton.style.border = 'none';
    // demoButton.style.borderRadius = '9999px';
    // demoButton.style.padding = '10px 20px';
    // demoButton.style.cursor = 'pointer';
    // demoButton.addEventListener('click', () => {
    //   document.body.removeChild(overlay);
    //   this.loadDefaultProduct();
    // });

    const uploadButton = document.createElement('button');
    uploadButton.textContent = 'Upload';
    uploadButton.style.backgroundColor = '#d00024';
    uploadButton.style.color = 'white';
    uploadButton.style.border = 'none';
    uploadButton.style.borderRadius = '9999px';
    uploadButton.style.padding = '10px 20px';
    uploadButton.style.cursor = 'pointer';
    uploadButton.addEventListener('click', () => {
      document.body.removeChild(overlay);
      const fileInput = document.querySelector('input[type="file"][accept=".glb,.gltf"]');
      if (fileInput) {
        fileInput.click();
      }
    });
    
    const browseButton = document.createElement('button');
    browseButton.textContent = 'Browse';
    browseButton.style.backgroundColor = '#d00024';
    browseButton.style.color = 'white';
    browseButton.style.border = 'none';
    browseButton.style.borderRadius = '9999px';
    browseButton.style.padding = '10px 20px';
    browseButton.style.cursor = 'pointer';
    browseButton.addEventListener('click', () => {
      document.body.removeChild(overlay);
      this.showBrowseInterface();
    });

    // buttonsContainer.appendChild(demoButton);
    buttonsContainer.appendChild(browseButton);
    buttonsContainer.appendChild(uploadButton);
    box.appendChild(title);
    box.appendChild(description);
    box.appendChild(buttonsContainer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  // -----------------------------------------------------------------------------
  // Browse Interface – Fetch and let the user select uploaded GLB files.
  // -----------------------------------------------------------------------------
  async showBrowseInterface() {
    try {
      const response = await fetch('/list-uploads');
      const files = await response.json();
      const modalOverlay = document.createElement('div');
      modalOverlay.style.position = 'fixed';
      modalOverlay.style.top = '0';
      modalOverlay.style.left = '0';
      modalOverlay.style.width = '100%';
      modalOverlay.style.height = '100%';
      modalOverlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
      modalOverlay.style.display = 'flex';
      modalOverlay.style.alignItems = 'center';
      modalOverlay.style.justifyContent = 'center';
      modalOverlay.style.zIndex = '10000';
      
      const modalContainer = document.createElement('div');
      modalContainer.style.backgroundColor = 'white';
      modalContainer.style.padding = '20px';
      modalContainer.style.borderRadius = '8px';
      modalContainer.style.minWidth = '300px';
      modalContainer.style.maxHeight = '80%';
      modalContainer.style.overflowY = 'auto';
      
      const title = document.createElement('h2');
      title.textContent = 'Browse Uploaded Models';
      modalContainer.appendChild(title);

      const description = document.createElement('p');
      description.textContent = 'To view the full product, ensure all parts are selected if it has multiple components.';
      modalContainer.appendChild(description);
      
      const fileList = document.createElement('div');
      fileList.style.marginTop = '10px';
      files.forEach(file => {
        const div = document.createElement('div');
        div.style.marginBottom = '5px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = file.url;
        checkbox.id = file.name;
        const label = document.createElement('label');
        label.htmlFor = file.name;
        label.textContent = file.name;
        label.style.marginLeft = '5px';
        div.appendChild(checkbox);
        div.appendChild(label);
        fileList.appendChild(div);
      });
      modalContainer.appendChild(fileList);
      
      const buttonsDiv = document.createElement('div');
      buttonsDiv.style.marginTop = '20px';
      buttonsDiv.style.textAlign = 'right';
      
      const loadButton = document.createElement('button');
      loadButton.textContent = 'Load Selected';
      loadButton.style.marginLeft = '10px';
      loadButton.style.padding = '8px 16px';
      loadButton.style.border = 'none';
      loadButton.style.borderRadius = '9999px';
      loadButton.style.background = '#d00024';
      loadButton.style.color = 'white';
      loadButton.style.cursor = 'pointer';
      
      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'Cancel';
      cancelButton.style.padding = '8px 16px';
      cancelButton.style.border = 'none';
      cancelButton.style.borderRadius = '9999px';
      cancelButton.style.background = '#999';
      cancelButton.style.color = 'white';
      cancelButton.style.cursor = 'pointer';
      
      buttonsDiv.appendChild(cancelButton);
      buttonsDiv.appendChild(loadButton);
      modalContainer.appendChild(buttonsDiv);
      modalOverlay.appendChild(modalContainer);
      document.body.appendChild(modalOverlay);
      
      loadButton.addEventListener('click', async () => {
        const selected = [];
        fileList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
          selected.push({ url: cb.value, name: cb.id });
        });
        if(selected.length > 0) {
          this.clearExistingModels();
          for(const file of selected) {
            await this.loadModel(file.url, file.name);
          }
          this.fitCameraToScene();
          
          // Add this broadcast for the host
          if (this.isHost) {
            // Broadcast the selected models to all clients
            this.socket.emit('browse-selection', { parts: selected });
          }
        }
        document.body.removeChild(modalOverlay);
      });
    
    cancelButton.addEventListener('click', () => {
        document.body.removeChild(modalOverlay);
      });
    } catch (error) {
      console.error("Error fetching uploaded models:", error);
    }
  }

  // -----------------------------------------------------------------------------
  // Pointer events (version 1)
  // -----------------------------------------------------------------------------
  handlePointerMove(event) {
    this.pointerNDC.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointerNDC.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  // -----------------------------------------------------------------------------
  // Upload Overlay (version 1)
  // -----------------------------------------------------------------------------
  createUploadOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'upload-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    overlay.style.color = 'white';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.fontSize = '24px';
    overlay.style.zIndex = '3000';
    overlay.textContent = 'Host is uploading a new product. Please wait.';
    document.body.appendChild(overlay);
    this.uploadOverlay = overlay;
  }

  showUploadOverlay() {
    if (this.uploadOverlay) {
      this.uploadOverlay.style.display = 'flex';
    }
  }

  hideUploadOverlay() {
    if (this.uploadOverlay) {
      this.uploadOverlay.style.display = 'none';
    }
  }

  // -----------------------------------------------------------------------------
  // Loading Overlay (for both demo and upload)
  // -----------------------------------------------------------------------------
  createLoadingOverlay() {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.backgroundColor = '#cccccc';
      overlay.style.display = 'none';
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
        <div id="loading-text" style="
          color: #333;
          margin-top: 20px;
          font-size: 14px;
          font-family: sans-serif;
        ">
          Loading...
        </div>
      `;
      document.body.appendChild(overlay);

      if (!document.getElementById('loading-overlay-style')) {
        const style = document.createElement('style');
        style.id = 'loading-overlay-style';
        style.textContent = `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `;
        document.head.appendChild(style);
      }
    }
  }

  // -----------------------------------------------------------------------------
  // Socket Listeners Integration
  // -----------------------------------------------------------------------------
  setupSocketListeners() {
    this.socket.on('host-transfer-request', (data) => {
      if (this.isHost) {
        showHostRequestModal(this, data, 30);
      }
    });

    this.socket.on('transfer-denied', (data) => {
      showConfirmationModal("Your request has been denied.");
      this.hostRequestPending = false;
      if (this.hostRequestTimer) {
        clearTimeout(this.hostRequestTimer);
        this.hostRequestTimer = null;
      }
    });

    this.socket.on('host-changed', (data) => {
      this.currentHostId = data.hostSocketId;
      this.isHost = data.hostSocketId ? (data.hostSocketId === this.socket.id) : false;
      console.log("Host changed; new hostSocketId:", data.hostSocketId, "isHost:", this.isHost);
      this.hostRequestPending = false;
      if (this.hostRequestTimer) {
        clearTimeout(this.hostRequestTimer);
        this.hostRequestTimer = null;
      }

      if (this.toggleUI) {
        updateToggleUI(this, this.toggleUI.viewerButton, this.toggleUI.hostButton, this.isHost);
      }

      if (this.isHost) {
        showConfirmationModal("You're now the host.");
      }
    });

    this.socket.on('product-upload-complete', async (data) => {
      this.showUploadOverlay();
      if (!this.isHost) {
        this.clearExistingModels();
      }
      const loadPromises = data.parts.map((part) => {
        if (!this.loadedModels.has(part.name)) {
          return this.loadModel(part.url, part.name);
        } else {
          return Promise.resolve();
        }
      });
      try {
        await Promise.all(loadPromises);
      } catch (error) {
        console.error("Error loading parts:", error);
      }
      this.hideUploadOverlay();
    });

    this.socket.on('model-transform', (modelState) => {
      if (!this.isHost) {
        const object = this.loadedModels.get(modelState.customId);
        if (object) {
          object.position.fromArray(modelState.position);
          object.rotation.fromArray(modelState.rotation);
          object.scale.fromArray(modelState.scale);
        } else {
          console.log(`No matching model found for customId: ${modelState.customId}`);
        }
      }
    });

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

    this.socket.on('host-pointer-toggle', (data) => {
      if (!this.isHost) {
        if (data.active) {
          if (!this.viewerPointer) {
            const pointerRadius = 0.005;
            const redMesh = new THREE.Mesh(
              new THREE.SphereGeometry(pointerRadius, 16, 16),
              new THREE.MeshBasicMaterial({ color: 0xff0000 })
            );
            const outlineMesh = redMesh.clone();
            outlineMesh.material = new THREE.MeshBasicMaterial({
              color: 0xffffff,
              side: THREE.BackSide
            });
            outlineMesh.scale.multiplyScalar(1.2);
            const pointerGroup = new THREE.Group();
            pointerGroup.add(outlineMesh);
            pointerGroup.add(redMesh);
            this.viewerPointer = pointerGroup;
            this.scene.add(this.viewerPointer);
          }
        } else {
          if (this.viewerPointer) {
            this.scene.remove(this.viewerPointer);
            this.viewerPointer = null;
          }
        }
      }
    });

    this.socket.on('host-pointer-update', (data) => {
      if (!this.isHost && this.viewerPointer) {
        this.viewerPointer.position.fromArray(data.position);
      }
    });

    this.socket.on('reset-all', (resetAll) => {
      if (this.productGroup) {
        this.productGroup.children.forEach((child) => {
          child.position.set(0, 0, 0);
          child.rotation.set(0, 0, 0);
          if (child.children.length > 0 && child.children[0].userData.originalScale) {
            child.scale.copy(child.children[0].userData.originalScale);
          } else {
            child.scale.set(1, 1, 1);
          }
        });
      }
      if (typeof this.fitCameraToScene === 'function') {
        this.fitCameraToScene();
      }
    });
  }

  // -----------------------------------------------------------------------------
  // Basic Initialization and Scene Setup
  // -----------------------------------------------------------------------------
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

    // Group for products (models)
    this.productGroup = new THREE.Group();
    this.scene.add(this.productGroup);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.xr.enabled = true;
    this.container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  setupScene() {
    this.scene.background = new THREE.Color(0xcccccc);
    this.rgbeLoader.load(
      '../assets/brown_photostudio_02_4k.hdr',
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.environment = texture;
        this.renderer.physicallyCorrectLights = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.5;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
      }
    );
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.2);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);
    window.sceneLight = {
      ambient: ambientLight,
      directional: directionalLight
    };
  }

  setupInitialControls() {
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.rotateSpeed = 0.5;
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.addEventListener('change', () => {
      if (this.isHost) {
        const cameraState = {
          position: this.camera.position.toArray(),
          rotation: this.camera.rotation.toArray(),
          target: this.orbitControls.target.toArray()
        };
        this.socket.emit('camera-update', cameraState);
      }
    });
    this.dragControls = new DragControls(this.draggableObjects, this.camera, this.renderer.domElement);
    this.dragControls.enabled = true;
    this.setupControlsEventListeners();
    this.renderer.domElement.addEventListener('touchstart', () => {});
  }

  setupControlsEventListeners() {
    this.dragControls.addEventListener('dragstart', () => {
      this.orbitControls.enabled = false;
      this.isDragging = true;
    });
    this.dragControls.addEventListener('dragend', () => {
      this.orbitControls.enabled = true;
      this.isDragging = false;
    });
    this.dragControls.addEventListener('drag', (event) => {
      const object = event.object;
      if (object.userData.originalScale) {
        object.scale.copy(object.userData.originalScale);
      }
      if (this.isHost) {
        const modelState = {
          customId: object.name,
          position: object.position.toArray(),
          rotation: object.rotation.toArray(),
          scale: object.scale.toArray()
        };
        this.socket.emit('model-transform', modelState);
      }
    });
  }

  updateDragControls() {
    const draggableObjects = Array.from(this.loadedModels.values());
    if (this.dragControls) {
      this.dragControls.dispose();
    }
    this.dragControls = new DragControls(draggableObjects, this.camera, this.renderer.domElement);
    this.setupControlsEventListeners();
  }

  clearExistingModels() {
    this.loadedModels.forEach(model => {
      if (model.parent) {
        this.productGroup.remove(model);
      }
    });
    this.loadedModels.clear();
    this.draggableObjects.length = 0;
    this.updateDragControls();
    if (this.isHost) {
      this.socket.emit('models-cleared');
    }
  }

  async loadDefaultProduct() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
    }
    this.clearExistingModels();
    const parts = [
      { name: 'blade', file: 'kool-mandoline-blade.glb' },
      { name: 'frame', file: 'kool-mandoline-frame.glb' },
      { name: 'handguard', file: 'kool-mandoline-handguard.glb' },
      { name: 'handle', file: 'kool-mandoline-handletpe.glb' }
    ];
    
    for (const part of parts) {
      await new Promise((resolve, reject) => {
        this.gltfLoader.load(
          `assets/${part.file}`,
          (gltf) => {
            const model = gltf.scene;
            const container = new THREE.Group();
            container.name = part.name;
            container.userData.isDraggable = true;
            container.add(model);

            container.raycast = function (raycaster, intersects) {
              const box = new THREE.Box3().setFromObject(container);
              if (!box.isEmpty()) {
                const intersectionPoint = new THREE.Vector3();
                if (raycaster.ray.intersectBox(box, intersectionPoint)) {
                  const distance = raycaster.ray.origin.distanceTo(intersectionPoint);
                  intersects.push({
                    distance: distance,
                    point: intersectionPoint.clone(),
                    object: container
                  });
                }
              }
            };

            this.draggableObjects.push(container);
            this.productGroup.add(container);
            this.loadedModels.set(part.name, container);
            this.updateDragControls();
            if (this.interactionManager) {
              this.interactionManager.setDraggableObjects(Array.from(this.loadedModels.values()));
            }
            this.fitCameraToScene();

            if (this.isHost) {
              this.socket.emit('model-loaded', { url: `assets/${part.file}`, name: part.name });
            }
            resolve();
          },
          undefined,
          (error) => {
            console.error(`Error loading model ${part.file}:`, error);
            reject(error);
          }
        );
      });
    }
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }
  }

  fitCameraToScene() {
    const box = new THREE.Box3().setFromObject(this.productGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fovRadians = this.camera.fov * (Math.PI / 180);
    let distance = Math.abs(maxDim / Math.tan(fovRadians / 2));
    distance *= 1.2;
    
    const offsetAngle = Math.PI / 4;
    const xOffset = distance * Math.cos(offsetAngle);
    const zOffset = distance * Math.sin(offsetAngle);
    const yOffset = distance * 0.5;
    
    this.camera.position.set(center.x + xOffset, center.y + yOffset, center.z + zOffset);
    this.orbitControls.target.copy(center);
    this.camera.updateProjectionMatrix();
    this.orbitControls.update();
  }

  async loadModel(url, name) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          const container = new THREE.Group();
          container.name = name;
          container.userData.isDraggable = true;
          container.add(model);

          container.raycast = function (raycaster, intersects) {
            const box = new THREE.Box3().setFromObject(container);
            if (!box.isEmpty()) {
              const intersectionPoint = new THREE.Vector3();
              if (raycaster.ray.intersectBox(box, intersectionPoint)) {
                const distance = raycaster.ray.origin.distanceTo(intersectionPoint);
                intersects.push({
                  distance: distance,
                  point: intersectionPoint.clone(),
                  object: container
                });
              }
            }
          };

          this.draggableObjects.push(container);
          this.productGroup.add(container);
          this.loadedModels.set(name, container);
          this.updateDragControls();
          if (this.interactionManager) {
            this.interactionManager.setDraggableObjects(Array.from(this.loadedModels.values()));
          }
          this.fitCameraToScene();
          console.log(`Loaded model: ${name}`);
          if (this.isHost) {
            this.socket.emit('model-loaded', { url, name });
          }
          resolve(container);
        },
        xhr => {},
        error => {
          console.error(`Error loading model ${name}:`, error);
          reject(error);
        }
      );
    });
  }

  animate() {
    this.renderer.setAnimationLoop((time, frame) => {
      // AR Tap-to-Place Reticle Update (version 2)
      if (this.isARMode && this.isPlacingProduct && this.hitTestSource && frame) {
        const referenceSpace = this.renderer.xr.getReferenceSpace();
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);
        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);
          if (this.placementReticle) {
            this.placementReticle.visible = true;
            this.placementReticle.position.set(
              pose.transform.position.x,
              pose.transform.position.y,
              pose.transform.position.z
            );
          }
        } else {
          if (this.placementReticle) {
            this.placementReticle.visible = false;
          }
        }
      }
      
      // Host Pointer Update (version 1)
      if (this.isHost && this.pointerActive && this.hostPointer) {
        const raycaster = new THREE.Raycaster();
        if (this.renderer.xr && this.renderer.xr.isPresenting && this.interactionManager && this.interactionManager.controller1) {
          const controller = this.interactionManager.controller1;
          const matrix = new THREE.Matrix4();
          matrix.extractRotation(controller.matrixWorld);
          const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(matrix);
          raycaster.set(controller.position, direction);
        } else {
          raycaster.setFromCamera(this.pointerNDC, this.camera);
        }
        const intersects = raycaster.intersectObjects(this.productGroup.children, true);
        if (intersects.length > 0) {
          const pointerPosition = intersects[0].point;
          this.hostPointer.position.copy(pointerPosition);
          this.socket.emit('host-pointer-update', { position: pointerPosition.toArray() });
        }
      }

      if (!this.isDragging) {
        this.orbitControls.update();
      }
      if (this.interactionManager) {
        this.interactionManager.update();
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  onARSessionStart() {
    console.log("AR session started - entering tap-to-place mode");
    this.isARMode = true;
    this.isPlacingProduct = true;
    if (this.productGroup) {
      this.productGroup.visible = false;
    }
    if (!this.placementReticle) {
      this.createPlacementUI();
      this.placementMessage.style.display = 'block';
    } else {
      this.placementMessage.style.display = 'block';
      this.placeAgainButton.style.display = 'none';
    }
    const arButton = document.querySelector('.ar-button');
    if (arButton) {
      arButton.style.display = 'none';
    }
    const session = this.renderer.xr.getSession();
    session.requestReferenceSpace('viewer').then((viewerSpace) => {
      session.requestHitTestSource({ space: viewerSpace }).then((source) => {
        this.hitTestSource = source;
      });
    });
    this.onSelectEventBound = this.onSelectEvent.bind(this);
    session.addEventListener('select', this.onSelectEventBound);
    session.addEventListener('end', () => {
      this.hitTestSource = null;
    });
  }

  createPlacementUI() {
    this.placementReticle = new THREE.Group();
    this.placementReticle.scale.set(0.3, 0.3, 0.3);
  
    const ringGeometry = new THREE.RingGeometry(0.15, 0.2, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    const reticleRing = new THREE.Mesh(ringGeometry, ringMaterial);
    reticleRing.rotation.x = -Math.PI / 2;
    this.placementReticle.add(reticleRing);
  
    const dotGeometry = new THREE.CircleGeometry(0.05, 32);
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    const reticleDot = new THREE.Mesh(dotGeometry, dotMaterial);
    reticleDot.rotation.x = -Math.PI / 2;
    this.placementReticle.add(reticleDot);
  
    this.placementReticle.visible = false;
    this.scene.add(this.placementReticle);
  
    this.placementMessage = document.createElement('div');
    this.placementMessage.style.position = 'absolute';
    this.placementMessage.style.bottom = '100px';
    this.placementMessage.style.left = '50%';
    this.placementMessage.style.transform = 'translateX(-50%)';
    this.placementMessage.style.fontSize = '20px';
    this.placementMessage.style.color = 'white';
    this.placementMessage.style.zIndex = '10000';
    this.placementMessage.innerText = 'Please tap to place';
    this.placementMessage.style.display = 'none';
    document.body.appendChild(this.placementMessage);
  
    this.placeAgainButton = document.createElement('button');
    this.placeAgainButton.textContent = 'Place Again';
    this.placeAgainButton.style.position = 'absolute';
    this.placeAgainButton.style.bottom = '80px';
    this.placeAgainButton.style.left = '50%';
    this.placeAgainButton.style.transform = 'translateX(-50%)';
    this.placeAgainButton.style.padding = '8px 16px';
    this.placeAgainButton.style.border = 'none';
    this.placeAgainButton.style.borderRadius = '4px';
    this.placeAgainButton.style.background = '#fff';
    this.placeAgainButton.style.color = '#000';
    this.placeAgainButton.style.fontSize = '13px';
    this.placeAgainButton.style.cursor = 'pointer';
    this.placeAgainButton.style.zIndex = '10000';
    this.placeAgainButton.style.display = 'none';
    document.body.appendChild(this.placeAgainButton);
  
    this.placeAgainButton.addEventListener('click', () => {
      if (this.productGroup) {
        this.productGroup.visible = false;
      }
      this.isPlacingProduct = true;
      this.placementMessage.style.display = 'block';
      this.placeAgainButton.style.display = 'none';
      const session = this.renderer.xr.getSession();
      if (session) {
        this.onSelectEventBound = this.onSelectEvent.bind(this);
        session.addEventListener('select', this.onSelectEventBound);
      }
    });
  }

  onSelectEvent(event) {
    if (this.isPlacingProduct && this.hitTestSource) {
      const frame = event.frame;
      const referenceSpace = this.renderer.xr.getReferenceSpace();
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);
  
        const bbox = new THREE.Box3().setFromObject(this.productGroup);
        const offsetY = bbox.min.y;
  
        this.productGroup.visible = true;
        this.productGroup.position.set(
          pose.transform.position.x,
          pose.transform.position.y - offsetY,
          pose.transform.position.z
        );
        console.log("Product placed at:", pose.transform.position, "with vertical offset:", offsetY);
  
        this.isPlacingProduct = false;
        this.placementMessage.style.display = 'none';
        if (this.placementReticle) {
          this.placementReticle.visible = false;
        }
        this.placeAgainButton.style.display = 'block';
        const session = this.renderer.xr.getSession();
        session.removeEventListener('select', this.onSelectEventBound);
      }
    }
  }

  // -----------------------------------------------------------------------------
  // Two-Finger Touch Rotation (version 2)
  // -----------------------------------------------------------------------------
  onTouchStart(e) {
    if (e.touches.length === 2 && this.productGroup && this.productGroup.visible) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      this.lastTouchAngle = Math.atan2(dy, dx);
    }
  }

  onTouchMove(e) {
    if (e.touches.length === 2 && this.lastTouchAngle !== null && this.productGroup && this.productGroup.visible) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const currentAngle = Math.atan2(dy, dx);
      const angleDiff = currentAngle - this.lastTouchAngle;
      this.productGroup.rotation.y += angleDiff;
      this.lastTouchAngle = currentAngle;
      e.preventDefault();
    }
  }

  onTouchEnd(e) {
    if (e.touches.length < 2) {
      this.lastTouchAngle = null;
    }
  }
}

// Create global file management utilities
window.FileManager = {
  // List all uploaded files
  listFiles: function() {
    return fetch('/list-uploads')
      .then(response => response.json())
      .then(files => {
        console.log("=== Uploaded Files ===");
        if (files.length === 0) {
          console.log("No files found");
        } else {
          files.forEach(file => console.log(file.name));
        }
        return files;
      })
      .catch(error => {
        console.error("Error listing files:", error);
      });
  },
  
  // Delete a specific file
  deleteFile: function(filename) {
    return fetch(`/delete-upload/${filename}`, {
      method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
      console.log(data.message || data.error);
      return data;
    })
    .catch(error => {
      console.error("Error deleting file:", error);
    });
  },
  
  // Delete all uploaded files
  deleteAllFiles: function() {
    if (!confirm("Are you sure you want to delete ALL uploaded files?")) {
      console.log("Operation cancelled");
      return Promise.resolve({message: "Operation cancelled"});
    }
    
    return fetch('/delete-all-uploads', {
      method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
      console.log(data.message || data.error);
      return data;
    })
    .catch(error => {
      console.error("Error deleting files:", error);
    });
  },
  
  // Help function to show available commands
  help: function() {
    console.log(`
=== File Manager Commands ===
FileManager.listFiles() - List all uploaded files
FileManager.deleteFile("filename.glb") - Delete a specific file
FileManager.deleteAllFiles() - Delete all uploaded files
FileManager.help() - Show this help information
    `);
  }
};

// Show help info when initialized
console.log("File Manager utilities loaded. Type FileManager.help() for available commands.");

const app = new App();
export default app;