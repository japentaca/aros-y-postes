import * as THREE from 'three';
import { GameState } from '../Globals.js';
import { CONFIG } from '../Config.js';
import { createSimpleSplinePath } from '../Spline.js';
import { TrailRibbon } from '../effects/TrailRibbon.js';
import { shuffle } from '../Utils.js';

// --- GEOMETRÍAS SINGLETON (compartidas por todos los drones del mismo tipo) ---
// Cada tipo es un Group ensamblado en buildDart/buildXwing/buildOrb.
// Convención: el "frente" del drone mira a +Z local (el lookAt orienta al
// drone apuntando su +Z al target, que es la dirección de la tangente).
const _dartBody = new THREE.ConeGeometry(0.18, 0.9, 6);
_dartBody.rotateX(Math.PI / 2);
const _dartWing = new THREE.BoxGeometry(0.7, 0.04, 0.22);
const _dartFin = new THREE.BoxGeometry(0.04, 0.22, 0.18);
const _dartTail = new THREE.ConeGeometry(0.12, 0.18, 6);
_dartTail.rotateX(-Math.PI / 2);

const _xwingBody = new THREE.SphereGeometry(0.16, 10, 8);
const _xwingArm = new THREE.BoxGeometry(0.55, 0.05, 0.1);
const _xwingRotor = new THREE.CylinderGeometry(0.13, 0.13, 0.02, 14);

const _orbCore = new THREE.SphereGeometry(0.22, 14, 12);
const _orbRing = new THREE.TorusGeometry(0.38, 0.025, 6, 24);
const _orbEye = new THREE.SphereGeometry(0.08, 10, 8);

const DRONE_TYPES = ['dart', 'xwing', 'orb'];

// Scratch vector (compartido por todas las instancias para evitar GC)
const _scratchDroneLook = new THREE.Vector3();

function buildDart(color) {
  // Dardo interceptor: cuerpo cónico + alas + aleta vertical + tobera.
  // Es la versión "engrosada" del antiguo birdGeometry aplastado.
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, flatShading: true });

  group.add(new THREE.Mesh(_dartBody, mat));

  const wingL = new THREE.Mesh(_dartWing, mat);
  wingL.position.set(-0.36, 0, -0.15);
  group.add(wingL);

  const wingR = new THREE.Mesh(_dartWing, mat);
  wingR.position.set(0.36, 0, -0.15);
  group.add(wingR);

  const fin = new THREE.Mesh(_dartFin, mat);
  fin.position.set(0, 0.15, -0.32);
  group.add(fin);

  const tail = new THREE.Mesh(_dartTail, mat);
  tail.position.set(0, 0, -0.5);
  group.add(tail);

  return group;
}

function buildXwing(color) {
  // Cuadricóptero: cuerpo esférico + 4 brazos en X + rotores translúcidos.
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, flatShading: true });
  const rotorMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.55, depthWrite: false
  });

  group.add(new THREE.Mesh(_xwingBody, mat));

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);

    const arm = new THREE.Mesh(_xwingArm, mat);
    arm.position.set(cx * 0.28, 0, cz * 0.28);
    arm.rotation.y = -angle;
    group.add(arm);

    const rotor = new THREE.Mesh(_xwingRotor, rotorMat);
    rotor.position.set(cx * 0.55, 0.01, cz * 0.55);
    group.add(rotor);
  }
  return group;
}

function buildOrb(color) {
  // Sonda orbitaria: esfera + anillo ecuatorial + ojo frontal emisivo.
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color });

  group.add(new THREE.Mesh(_orbCore, mat));

  const ring = new THREE.Mesh(_orbRing, mat);
  ring.rotation.x = Math.PI / 2; // Toro en XZ → perpendicular al eje de avance
  group.add(ring);

  const eye = new THREE.Mesh(_orbEye, eyeMat);
  eye.position.set(0, 0, 0.25);
  group.add(eye);

  return group;
}

const BUILDERS = { dart: buildDart, xwing: buildXwing, orb: buildOrb };

export class DroneBall {
  constructor(color, startId) {
    this.mesh = BUILDERS[DRONE_TYPES[Math.floor(Math.random() * DRONE_TYPES.length)]](color);
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

    const len = this.curve._cachedLength ?? this.curve.getLength();
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
        // Cada silueta (dardo/xwing/orb) fue construida con su "frente"
        // en +Z local, por lo que la misma lookAt funciona para las 3.
        const lookTarget = _scratchDroneLook.copy(point).add(tangent);
        this.mesh.lookAt(lookTarget);

        // Update Trail
        if (this.trail) this.trail.update(point, tangent);
      }
    }
  }

  dispose() {
    if (this.trail) this.trail.dispose();
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      // Recorrer el Group y liberar los materiales por instancia.
      // Las geometrías son singleton y NO se disponen.
      this.mesh.traverse(child => {
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }
  }
}
