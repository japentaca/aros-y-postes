import * as THREE from 'three';
import { CONFIG } from '../Config.js';
import { GameState } from '../Globals.js'; // Not used directly, but maybe for scene adding? No, parent adds.

function createBeaconTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Gradient from bottom (white/opaque) to top (transparent)
  const gradient = ctx.createLinearGradient(0, 64, 0, 0);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 64);

  return new THREE.CanvasTexture(canvas);
}

// Shared Geometry and Material for Beacons to save CPU
// Using global vars within module scope
const beaconGeometry = new THREE.CylinderGeometry(4, 1.5, 200, 16, 1, true); // Top radius 4, Bottom 1.5, Height 200, OpenEnded
beaconGeometry.translate(0, 100, 0); // Move pivot to bottom
const beaconTexture = createBeaconTexture();
const beaconMaterial = new THREE.MeshBasicMaterial({
  map: beaconTexture,
  transparent: true,
  opacity: 0.0, // Hidden by default
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

export class LightBeacon {
  constructor(ringMesh) {
    this.mesh = new THREE.Mesh(beaconGeometry, beaconMaterial.clone());
    this.ringMesh = ringMesh;

    // Initial placement will be handled by parent
    this.mesh.visible = false;
  }

  update(deltaTime = 0.016) {
    this._time = (this._time || 0) + deltaTime;

    if (!CONFIG.isNight) {
      this.mesh.visible = false;
      return;
    }

    const ringColor = this.ringMesh.material.color;
    this.mesh.material.color.copy(ringColor);
    const hex = ringColor.getHex();

    if (hex === 0x0088ff) {
      // Active (Blue) - animated pulse
      this.mesh.visible = true;
      const pulse = 0.12 + Math.abs(Math.sin(this._time * 2.5)) * 0.38;
      this.mesh.material.opacity = pulse;
      const scale = 1.0 + Math.sin(this._time * 1.8) * 0.13;
      this.mesh.scale.setScalar(scale);
    } else {
      this.mesh.visible = false;
    }
  }

  dispose() {
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      // material es clonado por instancia, hay que disponerlo
      if (this.mesh.material) this.mesh.material.dispose();
      // beaconGeometry / beaconMaterial / beaconTexture son singleton compartidos, NO se disponen
    }
  }
}
