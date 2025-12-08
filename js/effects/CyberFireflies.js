import * as THREE from 'three';
import { GameState } from '../Globals.js';
import { CONFIG } from '../Config.js';

function createFireflyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.5)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

export class CyberFireflies {
  constructor(count, range) {
    this.count = count;
    this.range = range;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    // Velocities: x, y, z
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * range;
      positions[i * 3 + 1] = Math.random() * 40; // Height 0-40
      positions[i * 3 + 2] = (Math.random() - 0.5) * range;

      velocities[i * 3] = (Math.random() - 0.5) * 0.2;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.PointsMaterial({
      color: 0xffff00,
      size: 0.5,
      map: createFireflyTexture(),
      transparent: true,
      opacity: 0.6,
      depthWrite: false, // Important for transparency
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    this.mesh = new THREE.Points(geometry, this.material);
    this.velocities = velocities;
    GameState.scene.add(this.mesh);
  }

  update(time, deltaTime) {
    if (!this.mesh) return;
    const positions = this.mesh.geometry.attributes.position.array;

    for (let i = 0; i < this.count; i++) {
      const ix = i * 3;
      const iy = i * 3 + 1;
      const iz = i * 3 + 2;

      // Update positions based on velocity
      positions[ix] += this.velocities[ix] * deltaTime * 10.0;
      positions[iy] += this.velocities[iy] * deltaTime * 10.0;
      positions[iz] += this.velocities[iz] * deltaTime * 10.0;

      // Gentle sine wave motion added to Y
      positions[iy] += Math.sin(time + positions[ix] * 0.05) * 0.02;

      // Boundary checks - Wrap around
      const halfRange = this.range / 2;
      if (positions[ix] > halfRange) positions[ix] -= this.range;
      if (positions[ix] < -halfRange) positions[ix] += this.range;

      if (positions[iz] > halfRange) positions[iz] -= this.range;
      if (positions[iz] < -halfRange) positions[iz] += this.range;

      if (positions[iy] > 50) positions[iy] = 0;
      if (positions[iy] < 0) positions[iy] = 50;
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;

    // Pulse opacity slightly
    this.material.opacity = (CONFIG.isNight ? 0.8 : 0.4) + Math.sin(time * 1.5) * 0.1;
  }

  setNightMode(isNight) {
    if (!this.mesh) return;
    if (isNight) {
      this.material.color.setHex(0x00ffff); // Cyan/Neon Blue
      this.material.size = 0.8;
    } else {
      this.material.color.setHex(0xffffaa); // Yellow/Pollen
      this.material.size = 0.4;
    }
  }

  dispose() {
    if (this.mesh) {
      GameState.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
  }
}
