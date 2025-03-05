// uiControls.js

import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { showViewerRequestModal, showConfirmationModal } from './modalManager.js';

// Create the UI controls and attach them to the app.
export function setupUIControls(app) {
  // Initialize state variables for host requests.
  app.hostRequestPending = false;
  app.hostRequestTimer = null;
  app.currentHostId = null; // Set by the server when a host is active.

  // Create a container for the controls.
  const controlsContainer = document.createElement('div');
  controlsContainer.style.position = 'fixed';
  controlsContainer.style.top = '10px';
  controlsContainer.style.left = '10px';
  controlsContainer.style.zIndex = '1000';
  controlsContainer.style.display = 'flex';
  controlsContainer.style.alignItems = 'center';
  controlsContainer.style.gap = '10px';

  // ------------------------------
  // Create the toggle buttons.
  // ------------------------------
  const toggleContainer = document.createElement('div');
  toggleContainer.style.display = 'inline-flex';
  toggleContainer.style.padding = '4px';
  toggleContainer.style.borderRadius = '9999px';
  toggleContainer.style.backgroundColor = '#d00024';

  // Create the Viewer button.
  const viewerButton = document.createElement('button');
  viewerButton.textContent = 'Viewer';
  viewerButton.style.padding = '5px 15px';
  viewerButton.style.border = 'none';
  viewerButton.style.outline = 'none';
  viewerButton.style.borderRadius = '9999px';
  viewerButton.style.cursor = 'pointer';
  viewerButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';

  // Create the Host button.
  const hostButton = document.createElement('button');
  hostButton.textContent = 'Host';
  hostButton.style.padding = '5px 15px';
  hostButton.style.border = 'none';
  hostButton.style.outline = 'none';
  hostButton.style.borderRadius = '9999px';
  hostButton.style.cursor = 'pointer';
  hostButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';

  // Set initial styling.
  updateToggleUI(app, viewerButton, hostButton, app.isHost);

  // ------------------------------
  // Define actions for the toggle buttons.
  // ------------------------------

  // Viewer button: relinquish host role.
  viewerButton.addEventListener('click', () => {
    if (app.isHost) {
      app.socket.emit('give-up-host');
    } else {
      if (app.hostRequestPending) {
        app.socket.emit('cancel-host-request');
        app.hostRequestPending = false;
        if (app.hostRequestTimer) {
          clearTimeout(app.hostRequestTimer);
          app.hostRequestTimer = null;
        }
        console.log("Host request cancelled.");
      } else {
        console.log("Already in viewer mode.");
      }
    }
  });

  // Host button.
  hostButton.addEventListener('click', () => {
    if (app.isHost) {
      app.socket.emit('give-up-host');
    } else {
      if (!app.currentHostId) {
        console.log("No active host; becoming host immediately.");
        app.currentHostId = app.socket.id;
        app.isHost = true;
        updateToggleUI(app, viewerButton, hostButton, app.isHost);
        showConfirmationModal("You're now the host.");
        app.socket.emit('register-host');
      } else {
        if (!app.hostRequestPending) {
          app.hostRequestPending = true;
          app.socket.emit('request-host');
          showViewerRequestModal(app, 30);
          console.log("Host request modal shown.");
        } else {
          console.log("Host request is already pending.");
        }
      }
    }
  });

  toggleContainer.appendChild(viewerButton);
  toggleContainer.appendChild(hostButton);
  controlsContainer.appendChild(toggleContainer);

  // ------------------------------
  // Example: Create an Upload button (optional).
  // ------------------------------
  const uploadButton = document.createElement('button');
  uploadButton.textContent = 'Upload Model';
  uploadButton.style.padding = '8px 24px';
  uploadButton.style.border = 'none';
  uploadButton.style.outline = 'none';
  uploadButton.style.borderRadius = '9999px';
  uploadButton.style.backgroundColor = '#d00024';
  uploadButton.style.color = 'white';
  uploadButton.style.cursor = 'pointer';
  uploadButton.style.transition = 'background-color 0.3s ease, color 0.3s ease';
  
  uploadButton.addEventListener('mouseover', () => {
    uploadButton.style.backgroundColor = '#b0001d';
  });
  uploadButton.addEventListener('mouseout', () => {
    uploadButton.style.backgroundColor = '#d00024';
  });
  
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.glb,.gltf';
  fileInput.style.display = 'none';
  fileInput.multiple = true;
  fileInput.onchange = (event) => {
    app.clearExistingModels();
    const files = event.target.files;
    for (let file of files) {
      const url = URL.createObjectURL(file);
      const name = file.name.replace('.glb', '').replace('.gltf', '');
      app.loadModel(url, name);
      if (app.isHost) {
        app.socket.emit('model-loaded', { url, name });
      }
    }
  };
  
  uploadButton.onclick = () => fileInput.click();
  
  controlsContainer.appendChild(uploadButton);
  controlsContainer.appendChild(fileInput);
  
  // ------------------------------
  // Optional: AR Button (if supported).
  // ------------------------------
  if ('xr' in navigator) {
    const arButton = ARButton.createButton(app.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body }
    });
    arButton.style.position = 'fixed';
    controlsContainer.appendChild(arButton);
  
    app.renderer.xr.addEventListener('sessionstart', () => {
      console.log("AR session started");
      app.isARMode = true;
      app.scene.background = null;
      app.renderer.setClearColor(0x000000, 0);
      if (app.isHost) {
        app.socket.emit('ar-session-start');
      }
    });
    app.renderer.xr.addEventListener('sessionend', () => {
      console.log("AR session ended");
      app.isARMode = false;
      app.scene.background = new THREE.Color(0xcccccc);
      app.renderer.setClearColor(0xcccccc, 1);
      if (app.isHost) {
        app.socket.emit('ar-session-end');
      }
    });
  }
  
  document.body.appendChild(controlsContainer);
  
  // Save references to the buttons.
  app.toggleUI = { viewerButton, hostButton };
}

export function updateToggleUI(app, viewerButton, hostButton, isHost) {
  if (isHost) {
    hostButton.style.backgroundColor = 'white';
    hostButton.style.color = '#d00024';
    viewerButton.style.backgroundColor = 'transparent';
    viewerButton.style.color = 'white';
  } else {
    viewerButton.style.backgroundColor = 'white';
    viewerButton.style.color = '#d00024';
    hostButton.style.backgroundColor = 'transparent';
    hostButton.style.color = 'white';
  }
}
