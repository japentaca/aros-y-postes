import * as THREE from 'three';
import { GameState } from '../Globals.js';
import { CONFIG } from '../Config.js';
import { createSimpleSplinePath } from '../Spline.js';
import { TrailRibbon } from '../effects/TrailRibbon.js';
import { shuffle } from '../Utils.js';

// --- GEOMETRÍA "AVIÓN/PÁJARO" (Bajo CPU) ---
// Geometría 'singleton' para todos los drones
const birdGeometry = new THREE.ConeGeometry(0.25, 0.8, 5); // Base pentagonal, forma de dardo
birdGeometry.rotateX(Math.PI / 2); // La punta del cono (originalmente Y+) ahora apunta a Z+
birdGeometry.scale(1.2, 0.3, 1);   // Aplanar Y y ensanchar X para alas

export class DroneBall {
  constructor(color, startId) {
    // Usamos la geometría de pájaro
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.3,
      flatShading: true
    });
    this.mesh = new THREE.Mesh(birdGeometry, mat);
    this.mesh.castShadow = true;

    // Create Trail Ribbon
    this.trail = new TrailRibbon(color);

    // Random scale between 1x (original) and 2x
    const s = 1 + Math.random();
    this.mesh.scale.setScalar(s);

    GameState.postsGroup.add(this.mesh);

    this.currentStartId = startId;
    this.curve = null;
    this.progress = 0;
    this.speed = CONFIG.speed * (0.8 + Math.random() * 0.4);
    this.nextStartId = 0;

    this.planNewRoute();
  }

  planNewRoute() {
    if (GameState.postsData.length < 2) return;

    const available = GameState.postsData.map(p => p.id).filter(id => id !== this.currentStartId);
    const routeIds = shuffle(available);

    this.nextStartId = routeIds[routeIds.length - 1];

    // Note: createSimpleSplinePath uses GameState.postsData internally
    this.curve = createSimpleSplinePath(this.currentStartId, routeIds);
    this.progress = 0;
  }

  update() {
    if (!this.curve) return;

    const len = this.curve.getLength();
    if (len < 1) return;

    const step = this.speed / len;
    this.progress += step;

    if (this.progress >= 1) {
      this.currentStartId = this.nextStartId;
      this.planNewRoute();
      // Reset trail? No, let it streak.
    } else {
      // Actualizar posición
      const point = this.curve.getPointAt(this.progress);
      this.mesh.position.copy(point);

      // --- ORIENTACIÓN ---
      // Mirar hacia adelante en la curva
      const tangent = this.curve.getTangentAt(this.progress);
      if (tangent) {
        // lookAt hace que el eje +Z local apunte al target.
        // Nuestra geometría tiene la punta en +Z.
        const lookTarget = point.clone().add(tangent);
        this.mesh.lookAt(lookTarget);

        // Update Trail
        if (this.trail) this.trail.update(point, tangent);
      }
    }
  }

  dispose() {
    if (this.trail) this.trail.dispose();
  }
}
