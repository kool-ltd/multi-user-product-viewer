import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';

export class InteractionManager {
  constructor(scene, camera, domElement) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;

    // To track the container being dragged and the drag offset.
    this.activeDraggable = null;
    this.dragOffset = new THREE.Vector3();

    this.setupOrbitControls();
    this.setupDragControls();
  }

  setupOrbitControls() {
    this.orbitControls = new OrbitControls(this.camera, this.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
  }

  setupDragControls() {
    // Initialize DragControls with an empty array. The objects are managed externally.
    this.dragControls = new DragControls([], this.camera, this.domElement);
    this.setupDragControlsEvents();
  }

  setupDragControlsEvents() {
    this.dragControls.addEventListener('dragstart', (event) => {
      // Disable orbit controls during a drag.
      this.orbitControls.enabled = false;

      // Find the top-level container that should be moved.
      let targetObject = event.object;
      while (targetObject.parent && !targetObject.userData.isDraggable) {
        targetObject = targetObject.parent;
      }
      this.activeDraggable = targetObject;

      // Record the offset from the container's world position to the dragged child's world position.
      const parentWorldPos = new THREE.Vector3();
      this.activeDraggable.getWorldPosition(parentWorldPos);

      const childWorldPos = new THREE.Vector3();
      event.object.getWorldPosition(childWorldPos);

      // This offset will be preserved during dragging.
      this.dragOffset.copy(childWorldPos).sub(parentWorldPos);
    });

    this.dragControls.addEventListener('drag', (event) => {
      if (!this.activeDraggable) return;

      // Get the current world position of the dragged child.
      const currentChildWorldPos = new THREE.Vector3();
      event.object.getWorldPosition(currentChildWorldPos);

      // Compute the new container position so that: newParentPos = currentChildWorldPos - dragOffset.
      const newParentWorldPos = new THREE.Vector3().subVectors(currentChildWorldPos, this.dragOffset);
      this.activeDraggable.position.copy(newParentWorldPos);

      // Now, reset the child's position so that its local position relative to the parent remains unchanged.
      // Desired world position for the child should be: parent's new world position + offset.
      const desiredChildWorldPos = new THREE.Vector3().addVectors(newParentWorldPos, this.dragOffset);
      const desiredChildLocalPos = this.activeDraggable.worldToLocal(desiredChildWorldPos.clone());
      event.object.position.copy(desiredChildLocalPos);

      // If an original scale was saved, restore it.
      if (this.activeDraggable.userData.originalScale) {
        this.activeDraggable.scale.copy(this.activeDraggable.userData.originalScale);
      }
    });

    this.dragControls.addEventListener('dragend', () => {
      // Re-enable orbit controls and clear our temporary drag data.
      this.orbitControls.enabled = true;
      this.activeDraggable = null;
      this.dragOffset.set(0, 0, 0);
    });
  }

  setDraggableObjects(objects) {
    // Refresh the DragControls with new objects.
    this.dragControls.dispose();
    this.dragControls = new DragControls(objects, this.camera, this.domElement);
    this.setupDragControlsEvents();
  }

  update() {
    this.orbitControls.update();
  }
}