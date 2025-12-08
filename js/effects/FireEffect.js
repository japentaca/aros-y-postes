import * as THREE from 'three';
import { GameState } from '../Globals.js';
import { CONFIG } from '../Config.js';

export class FireEffect {
  constructor(hoop) {
    this.hoop = hoop; // Reference to the hoop mesh
    this.particles = [];
    this.enabled = false;
    this.particlePool = [];
    this.maxParticles = 200;

    // Create particle geometry and material
    this.particleGeometry = new THREE.SphereGeometry(0.15, 8, 8);

    // Create particles pool for performance
    for (let i = 0; i < this.maxParticles; i++) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 1.0,
        emissive: 0xffaa00,
        emissiveIntensity: 2.0,
        roughness: 0.5,
        metalness: 0.0
      });
      const particle = new THREE.Mesh(this.particleGeometry, material);
      particle.visible = false;
      GameState.scene.add(particle);
      this.particlePool.push({
        mesh: particle,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        active: false
      });
    }
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    // Hide all active particles
    this.particlePool.forEach(p => {
      p.active = false;
      p.mesh.visible = false;
    });
  }

  spawnParticle() {
    // Find inactive particle
    const particle = this.particlePool.find(p => !p.active);
    if (!particle) return;

    // Get hoop world position (not local position)
    const hoopPos = new THREE.Vector3();
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
    const rotatedX = localX * Math.cos(hoopRotation) + localZ * Math.sin(hoopRotation);
    const rotatedZ = -localX * Math.sin(hoopRotation) + localZ * Math.cos(hoopRotation);

    particle.mesh.position.set(
      hoopPos.x + rotatedX,
      hoopPos.y + localY,
      hoopPos.z + rotatedZ
    );

    // Set initial velocity - upward with outward spread and turbulence
    const spreadForce = 0.5 + Math.random() * 1.5;
    particle.velocity.set(
      (Math.random() - 0.5) * spreadForce + rotatedX * 0.1,
      1.5 + Math.random() * 2.0, // Strong upward force
      (Math.random() - 0.5) * spreadForce + rotatedZ * 0.1
    );

    particle.life = 0;
    particle.maxLife = 0.8 + Math.random() * 0.7; // 0.8 to 1.5 seconds
    particle.active = true;
    particle.mesh.visible = true;

    // Initial color - bright yellow/white
    particle.mesh.material.color.setHex(0xffff88);
    particle.mesh.material.emissive.setHex(0xffff88);
    particle.mesh.material.opacity = 1.0;
    particle.mesh.scale.setScalar(1.0);
  }

  update(deltaTime) {
    // Spawn new particles only when enabled - more in night mode for extra glow
    if (this.enabled) {
      const spawnRate = CONFIG.isNight ? 8 : 5;
      for (let i = 0; i < spawnRate; i++) {
        this.spawnParticle();
      }
    }

    // Always update active particles (even when disabled) so they can fade out properly
    this.particlePool.forEach(particle => {
      if (!particle.active) return;

      particle.life += deltaTime;

      if (particle.life >= particle.maxLife) {
        particle.active = false;
        particle.mesh.visible = false;
        return;
      }

      // Calculate life progress (0 to 1)
      const lifeProgress = particle.life / particle.maxLife;

      // Update position
      particle.mesh.position.add(particle.velocity.clone().multiplyScalar(deltaTime));

      // Apply gravity and turbulence
      particle.velocity.y -= 0.5 * deltaTime; // Slight gravity
      particle.velocity.x += (Math.random() - 0.5) * 2.0 * deltaTime; // Turbulence
      particle.velocity.z += (Math.random() - 0.5) * 2.0 * deltaTime;

      // Damping
      particle.velocity.multiplyScalar(0.98);

      // Color transition: white/yellow -> orange -> red -> dark red/black
      let color, emissive;
      if (lifeProgress < 0.2) {
        // Bright white/yellow core
        color = new THREE.Color().setHSL(0.15, 1.0, 0.9 - lifeProgress * 2);
        emissive = color.clone();
      } else if (lifeProgress < 0.5) {
        // Orange
        const t = (lifeProgress - 0.2) / 0.3;
        color = new THREE.Color().setHSL(0.08 - t * 0.05, 1.0, 0.6 - t * 0.2);
        emissive = color.clone();
      } else if (lifeProgress < 0.8) {
        // Red
        const t = (lifeProgress - 0.5) / 0.3;
        color = new THREE.Color().setHSL(0.0, 1.0 - t * 0.3, 0.4 - t * 0.2);
        emissive = color.clone().multiplyScalar(0.8);
      } else {
        // Dark red to black
        const t = (lifeProgress - 0.8) / 0.2;
        color = new THREE.Color().setHSL(0.0, 0.7 - t * 0.7, 0.2 - t * 0.2);
        emissive = color.clone().multiplyScalar(0.3);
      }

      particle.mesh.material.color.copy(color);
      particle.mesh.material.emissive.copy(emissive);
      particle.mesh.material.emissiveIntensity = CONFIG.isNight ? 3.0 : 2.0;

      // Fade out and shrink
      particle.mesh.material.opacity = 1.0 - Math.pow(lifeProgress, 2);
      particle.mesh.scale.setScalar(1.0 - lifeProgress * 0.5);
    });
  }

  dispose() {
    this.particlePool.forEach(p => {
      GameState.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    });
    this.particlePool = [];
  }
}
