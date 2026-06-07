import * as THREE from 'three';
import { GameState } from '../Globals.js';
import { CONFIG } from '../Config.js';

// Soft circular sprite (shared across all fire effects)
function createFireSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
  grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.15)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _fireSprite = createFireSprite();

// Shared GLSL — vertex + fragment for a soft, additive point sprite
const FIRE_VERT = /* glsl */`
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uPixelRatio;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FIRE_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  uniform sampler2D uMap;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    if (tex.a < 0.01) discard;
    gl_FragColor = vec4(vColor, tex.a * vAlpha);
  }
`;

export class FireEffect {
  constructor(hoop) {
    this.hoop = hoop;
    this.enabled = false;
    this.maxParticles = 200;
    this.spawnCursor = 0;

    // Particle pool state arrays (no per-particle objects)
    this.life = new Float32Array(this.maxParticles);
    this.maxLife = new Float32Array(this.maxParticles);
    this.velX = new Float32Array(this.maxParticles);
    this.velY = new Float32Array(this.maxParticles);
    this.velZ = new Float32Array(this.maxParticles);
    this.posX = new Float32Array(this.maxParticles);
    this.posY = new Float32Array(this.maxParticles);
    this.posZ = new Float32Array(this.maxParticles);
    this.size = new Float32Array(this.maxParticles);
    this.alpha = new Float32Array(this.maxParticles);
    this.spawnX = new Float32Array(this.maxParticles);
    this.spawnZ = new Float32Array(this.maxParticles);

    // GPU attributes
    const positions = new Float32Array(this.maxParticles * 3);
    const colors = new Float32Array(this.maxParticles * 3);
    const sizes = new Float32Array(this.maxParticles);
    const alphas = new Float32Array(this.maxParticles);
    // Hide all initially
    for (let i = 0; i < this.maxParticles; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -10000; // far away, off-screen
      positions[i * 3 + 2] = 0;
      sizes[i] = 0;
      alphas[i] = 0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.geometry = geometry;

    this.material = new THREE.ShaderMaterial({
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: {
        uMap: { value: _fireSprite },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // particles spread; avoid culling
    GameState.scene.add(this.points);
  }

  enable() { this.enabled = true; }

  disable() {
    this.enabled = false;
    // Hide all active particles
    for (let i = 0; i < this.maxParticles; i++) {
      this.life[i] = 0;
      this.maxLife[i] = 0;
      this.alpha[i] = 0;
      this.size[i] = 0;
    }
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }

  _spawnParticle(idx) {
    const hoopPos = _scratchHoopPos;
    this.hoop.getWorldPosition(hoopPos);
    const hoopRotation = this.hoop.rotation.y;

    // Spawn particle at random point on the hoop's circumference
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.5; // Hoop radius

    // Local coordinates on the Vertical Ring (XY plane)
    const localX = Math.cos(angle) * radius;
    const localY = Math.sin(angle) * radius;
    const localZ = (Math.random() - 0.5) * 0.3; // Random thickness

    // Rotate offset based on hoop rotation (Y-axis rotation)
    const cosR = Math.cos(hoopRotation);
    const sinR = Math.sin(hoopRotation);
    const rotatedX = localX * cosR + localZ * sinR;
    const rotatedZ = -localX * sinR + localZ * cosR;

    this.posX[idx] = hoopPos.x + rotatedX;
    this.posY[idx] = hoopPos.y + localY;
    this.posZ[idx] = hoopPos.z + rotatedZ;
    this.spawnX[idx] = rotatedX;
    this.spawnZ[idx] = rotatedZ;

    // Set initial velocity - upward with outward spread and turbulence
    const spreadForce = 0.5 + Math.random() * 1.5;
    this.velX[idx] = (Math.random() - 0.5) * spreadForce + rotatedX * 0.1;
    this.velY[idx] = 1.5 + Math.random() * 2.0;
    this.velZ[idx] = (Math.random() - 0.5) * spreadForce + rotatedZ * 0.1;

    this.life[idx] = 0;
    this.maxLife[idx] = 0.8 + Math.random() * 0.7;
  }

  update(deltaTime) {
    const positions = this.geometry.attributes.position.array;
    const colors = this.geometry.attributes.aColor.array;
    const sizes = this.geometry.attributes.aSize.array;
    const alphas = this.geometry.attributes.aAlpha.array;
    const isNight = CONFIG.isNight;
    const baseSize = 1.2;
    const baseIntensity = isNight ? 3.0 : 2.0;

    // Spawn new particles
    if (this.enabled) {
      const spawnRate = isNight ? 8 : 5;
      for (let s = 0; s < spawnRate; s++) {
        // Find an inactive slot (round-robin is faster)
        let idx = -1;
        for (let i = 0; i < this.maxParticles; i++) {
          const k = (this.spawnCursor + i) % this.maxParticles;
          if (this.life[k] === 0) { idx = k; break; }
        }
        if (idx < 0) break; // pool exhausted
        this._spawnParticle(idx);
        this.spawnCursor = (idx + 1) % this.maxParticles;
      }
    }

    // Update active particles
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.life[i] === 0) {
        alphas[i] = 0;
        sizes[i] = 0;
        continue;
      }

      this.life[i] += deltaTime;
      if (this.life[i] >= this.maxLife[i]) {
        this.life[i] = 0;
        alphas[i] = 0;
        sizes[i] = 0;
        continue;
      }

      const t = this.life[i] / this.maxLife[i];

      // Integrate velocity into position
      this.posX[i] += this.velX[i] * deltaTime;
      this.posY[i] += this.velY[i] * deltaTime;
      this.posZ[i] += this.velZ[i] * deltaTime;

      // Gravity + turbulence
      this.velY[i] -= 0.5 * deltaTime;
      this.velX[i] += (Math.random() - 0.5) * 2.0 * deltaTime;
      this.velZ[i] += (Math.random() - 0.5) * 2.0 * deltaTime;

      // Damping
      this.velX[i] *= 0.98;
      this.velY[i] *= 0.98;
      this.velZ[i] *= 0.98;

      // Compute color (reused scratch Color)
      if (t < 0.2) {
        _scratchColor.setHSL(0.15, 1.0, 0.9 - t * 2);
      } else if (t < 0.5) {
        const k = (t - 0.2) / 0.3;
        _scratchColor.setHSL(0.08 - k * 0.05, 1.0, 0.6 - k * 0.2);
      } else if (t < 0.8) {
        const k = (t - 0.5) / 0.3;
        _scratchColor.setHSL(0.0, 1.0 - k * 0.3, 0.4 - k * 0.2);
      } else {
        const k = (t - 0.8) / 0.2;
        _scratchColor.setHSL(0.0, 0.7 - k * 0.7, 0.2 - k * 0.2);
      }
      // Brightness multiplier (emissive intensity baked into color for additive)
      const intensity = baseIntensity;
      colors[i * 3]     = _scratchColor.r * intensity;
      colors[i * 3 + 1] = _scratchColor.g * intensity;
      colors[i * 3 + 2] = _scratchColor.b * intensity;

      // Fade out and shrink
      alphas[i] = 1.0 - t * t;
      sizes[i] = baseSize * (1.0 - t * 0.5);

      positions[i * 3]     = this.posX[i];
      positions[i * 3 + 1] = this.posY[i];
      positions[i * 3 + 2] = this.posZ[i];
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  dispose() {
    if (this.points) {
      GameState.scene.remove(this.points);
      this.geometry.dispose();
      this.material.dispose();
      // _fireSprite es singleton compartido, NO se dispone
    }
  }
}

// Module-level scratch (reused across all fire effects)
const _scratchHoopPos = new THREE.Vector3();
const _scratchColor = new THREE.Color();
