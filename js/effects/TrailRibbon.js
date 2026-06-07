import * as THREE from 'three';
import { GameState } from '../Globals.js';
import { CONFIG } from '../Config.js';

// Scratch vectors (compartidos por todas las instancias para evitar GC)
const _scratchUp = new THREE.Vector3(0, 1, 0);
const _scratchRight = new THREE.Vector3();

export class TrailRibbon {
  constructor(color) {
    this.maxPoints = 40;
    this.width = 0.6;
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
    // Add new point to history (reused scratch vector to avoid GC)
    _scratchRight.crossVectors(direction, _scratchUp).normalize();
    if (_scratchRight.lengthSq() < 0.1) {
      _scratchRight.set(1, 0, 0);
    }
    _scratchRight.multiplyScalar(this.width);

    this.history.unshift({
      posX: position.x, posY: position.y, posZ: position.z,
      rightX: _scratchRight.x, rightY: _scratchRight.y, rightZ: _scratchRight.z
    });

    // Trim history
    if (this.history.length > this.maxPoints) {
      this.history.pop();
    }

    if (this.history.length < 2) return;

    this.mesh.visible = true;

    // Update Geometry
    const positions = this.geometry.attributes.position.array;
    const histLen = this.history.length;

    for (let i = 0; i < histLen; i++) {
      const node = this.history[i];
      // Taper width at the tail for smoothness
      const life = 1.0 - (i / histLen); // 1.0 at head, 0.0 at tail
      const wX = node.rightX * life;
      const wY = node.rightY * life;
      const wZ = node.rightZ * life;

      const idx = i * 6; // 2 vertices * 3 coords

      // Left vertex
      positions[idx]     = node.posX - wX;
      positions[idx + 1] = node.posY - wY;
      positions[idx + 2] = node.posZ - wZ;
      // Right vertex
      positions[idx + 3] = node.posX + wX;
      positions[idx + 4] = node.posY + wY;
      positions[idx + 5] = node.posZ + wZ;
    }

    // Zero out unused vertices (collapse to last point)
    if (histLen < this.maxPoints) {
      const lastNode = this.history[histLen - 1];
      for (let i = histLen; i < this.maxPoints; i++) {
        const idx = i * 6;
        positions[idx]     = lastNode.posX;
        positions[idx + 1] = lastNode.posY;
        positions[idx + 2] = lastNode.posZ;
        positions[idx + 3] = lastNode.posX;
        positions[idx + 4] = lastNode.posY;
        positions[idx + 5] = lastNode.posZ;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.setDrawRange(0, (histLen - 1) * 6);

    // Night Mode Logic
    this.material.opacity = CONFIG.isNight ? 0.8 : 0.4;
  }

  dispose() {
    GameState.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
