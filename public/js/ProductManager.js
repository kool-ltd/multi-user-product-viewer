import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class ProductManager {
    constructor() {
        this.loader = new GLTFLoader();
        this.parts = new Map();
    }

    async loadPart(url, customId = null) {
        try {
            const gltf = await this.loader.loadAsync(url);
            const model = gltf.scene;

            // Preserve original scale
            const originalScale = model.scale.clone();
            model.userData.originalScale = originalScale;

            // Use customId if provided; otherwise generate one.
            const partId = customId || `part_${this.parts.size}`;
            model.name = partId;  // Set object's name for consistent identification.
            this.parts.set(partId, model);

            return model;
        } catch (error) {
            console.error('Error loading part:', error);
        }
    }

    clearParts() {
        this.parts.forEach(part => {
            if (part.parent) {
                part.parent.remove(part);
            }
        });
        this.parts.clear();
    }

    getParts() {
        return Array.from(this.parts.values());
    }
}
