// SceneManager.js
import * as THREE from 'three';

export class SceneManager {
  constructor(container) {
    this.container = container;
    console.log("SceneManager: constructor called");
    this.setupScene();
    this.setupCamera();
    this.setupRenderer();
    this.setupLights();
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);
    console.log("SceneManager: setupScene executed – scene created with white background");
  }

  setupCamera() {
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 1.6, 3);
    console.log("SceneManager: setupCamera executed – camera positioned at (0, 1.6, 3)");
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    
    // Enable XR and add tone mapping settings
    this.renderer.xr.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    // Append the renderer's DOM element
    this.container.appendChild(this.renderer.domElement);

    // Listen for XR session start
    this.renderer.xr.addEventListener('sessionstart', () => {
      this.isARMode = true;
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0); // Clear with transparent background for AR
      console.log("SceneManager: XR session started – AR mode enabled");
    });
    console.log("SceneManager: setupRenderer executed – renderer created and appended");
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);
    
    console.log("SceneManager: setupLights executed – ambient and directional lights added");
  }

  setEnvironmentMap(envMap) {
    this.scene.environment = envMap;
    this.scene.background = envMap;
    console.log("SceneManager: setEnvironmentMap executed – environment map set");
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    console.log("SceneManager: onWindowResize executed");
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}