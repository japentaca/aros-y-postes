import * as THREE from 'three';
import { GameState } from '../Globals.js';
import { CONFIG } from '../Config.js';

export class TrailRibbon {
  constructor(color) {
    this.maxPoints = 20;
    this.width = 0.4;
    this.history = []; // Stores { pos: Vector3, normal: Vector3 }

    // Initialize BufferGeometry
    // 2 vertices per point (Left, Right)
    // (maxPoints) * 2 vertices
    const vertexCount = this.maxPoints * 2;
    const indices = [];

    // Construct triangle strip indices
    // 0 1
    // 2 3 ...
    for (let i = 0; i < this.maxPoints - 1; i++) {
      const base = i * 2;
      // Triangle 1: 0, 1, 2
      indices.push(base, base + 1, base + 2);
      // Triangle 2: 1, 3, 2
      indices.push(base + 1, base + 3, base + 2);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setIndex(indices);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));

    // UVs/Colors for fading? For now just simple opacity fade via vertex colors could be nice but complex.
    // Let's stick to simple translucent material first.

    this.material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);

    // Hide until we have data
    this.mesh.frustumCulled = false; // Always draw if visible
    this.mesh.visible = false;

    GameState.scene.add(this.mesh);
  }

  update(position, direction) {
    // Add new point to history
    // We use the direction to calculate the "wing" vector (Right vector)
    const up = new THREE.Vector3(0, 1, 0);
    let right = new THREE.Vector3().crossVectors(direction, up).normalize();

    if (right.lengthSq() < 0.1) {
      // Fallback if direction is vertical
      right.set(1, 0, 0);
    }

    this.history.unshift({
      pos: position.clone(),
      right: right.multiplyScalar(this.width)
    });

    // Trim history
    if (this.history.length > this.maxPoints) {
      this.history.pop();
    }

    if (this.history.length < 2) return;

    this.mesh.visible = true;

    // Update Geometry
    const positions = this.geometry.attributes.position.array;

    // We need to fill the buffer from the HEAD (newest) to TAIL (oldest)
    // But the Trail should taper or stay constant.

    for (let i = 0; i < this.history.length; i++) {
      const node = this.history[i];

      // Taper width at the tail for smoothness
      const life = 1.0 - (i / this.history.length); // 1.0 at head, 0.0 at tail
      const currentWidth = node.right.clone().multiplyScalar(life); // Shrink width at tail

      const pLeft = node.pos.clone().sub(currentWidth);
      const pRight = node.pos.clone().add(currentWidth);

      const idx = i * 6; // 2 vertices * 3 coords

      positions[idx] = pLeft.x;
      positions[idx + 1] = pLeft.y;
      positions[idx + 2] = pLeft.z;

      positions[idx + 3] = pRight.x;
      positions[idx + 4] = pRight.y;
      positions[idx + 5] = pRight.z;
    }

    // Zero out unused vertices (collapse to last point)
    if (this.history.length < this.maxPoints) {
      const lastNode = this.history[this.history.length - 1];
      for (let i = this.history.length; i < this.maxPoints; i++) {
        const idx = i * 6;
        positions[idx] = lastNode.pos.x;
        positions[idx + 1] = lastNode.pos.y;
        positions[idx + 2] = lastNode.pos.z;
        positions[idx + 3] = lastNode.pos.x;
        positions[idx + 4] = lastNode.pos.y;
        positions[idx + 5] = lastNode.pos.z;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.setDrawRange(0, (this.history.length - 1) * 6);

    // Night Mode Logic
    if (CONFIG.isNight) {
      this.material.opacity = 0.8;
    } else {
      this.material.opacity = 0.4;
    }
  }

  dispose() {
    GameState.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
