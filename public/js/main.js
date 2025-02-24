import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { ProductManager } from './ProductManager.js';
import { SceneManager } from './SceneManager.js';
import { InteractionManager } from './InteractionManager.js';

class App {
    constructor() {
        this.container = document.getElementById('scene-container');
        this.sceneManager = new SceneManager(this.container);
        this.productManager = new ProductManager();
        this.interactionManager = new InteractionManager(
            this.sceneManager.scene,
            this.sceneManager.camera,
            this.container
        );

        this.init();
        this.setupEventListeners();
        this.animate();
    }

    async init() {
        // Load environment map
        const rgbeLoader = new RGBELoader();
        const envMap = await rgbeLoader.loadAsync('assets/brown_photostudio_02_4k.hdr');
        this.sceneManager.setEnvironmentMap(envMap);

        // Load default product (mandoline)
        await this.loadDefaultProduct();

        // Setup XR
        document.body.appendChild(VRButton.createButton(this.sceneManager.renderer));
        document.body.appendChild(ARButton.createButton(this.sceneManager.renderer));
    }

    async loadDefaultProduct() {
        const parts = [
            'kool-mandoline-blade.glb',
            'kool-mandoline-frame.glb',
            'kool-mandoline-handguard.glb',
            'kool-mandoline-handletpe.glb'
        ];

        for (const part of parts) {
            await this.productManager.loadPart(`assets/${part}`);
        }
    }

    setupEventListeners() {
        const fileInput = document.getElementById('part-upload');
        fileInput.addEventListener('change', (event) => {
            this.handleFileUpload(event.target.files);
        });

        window.addEventListener('resize', () => {
            this.sceneManager.onWindowResize();
        });
    }

    async handleFileUpload(files) {
        // Clear existing parts
        this.productManager.clearParts();

        // Load new parts
        for (const file of files) {
            const url = URL.createObjectURL(file);
            await this.productManager.loadPart(url);
            URL.revokeObjectURL(url);
        }
    }

    animate() {
        this.sceneManager.renderer.setAnimationLoop(() => {
            this.interactionManager.update();
            this.sceneManager.render();
        });
    }
}

// Start the application
new App();
