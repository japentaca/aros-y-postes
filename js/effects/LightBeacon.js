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

  update() {
    // Only visible in Night Mode
    if (!CONFIG.isNight) {
      this.mesh.visible = false;
      return;
    }

    this.mesh.visible = true;

    // Sync color with the ring (Poste)
    const ringColor = this.ringMesh.material.color;
    this.mesh.material.color.copy(ringColor);

    // Intensity logic:
    // Active (Blue) or Passed (Red) -> High Opacity
    // Inactive (Yellow) -> Low Opacity
    // We guess state by color hex for simplicity (Yellow is approx 0xffaa00)

    // Get Hex value to check state
    const hex = ringColor.getHex();

    if (hex === 0xffaa00) {
      // Inactive (Yellow)
      this.mesh.material.opacity = 0.05;
      this.mesh.scale.setScalar(0.8);
    } else if (hex === 0x0088ff) {
      // Active (Blue) - BEACON!
      this.mesh.material.opacity = 0.3;
      this.mesh.scale.setScalar(1.2);
    } else {
      // Passed (Red) or others
      this.mesh.material.opacity = 0.15;
      this.mesh.scale.setScalar(1.0);
    }
  }
}
