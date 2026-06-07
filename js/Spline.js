import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { GameState } from './Globals.js';
import { pointToSegmentDistance } from './Utils.js';

// Distancia virtual "recto hacia adelante" usada como lookAt fijo durante
// un PASS_THROUGH: la cámara apunta a un punto muy lejano en la dirección
// del normal del aro, lo que equivale (en la práctica) a mirar paralelo al
// plano del aro. Mantener este valor grande reduce el cambio aparente de
// dirección de mirada cuando la cámara se mueve dentro del segmento.
const LOOK_AHEAD = 50;

// Construye la lista de segmentos de cámara para una vuelta.
// Cada segmento es un objeto con:
//   type:        'APPROACH' | 'PASS_THROUGH' | 'FLIGHT_UP' | 'FLIGHT_DOWN'
//   start, end:  THREE.Vector3 (puntos inicial y final del segmento recto)
//   length:      distancia start→end (precomputada para integrar velocidad)
//   lookAtStart: THREE.Vector3 (punto al que se mira al inicio del segmento)
//   lookAtEnd:   THREE.Vector3 (punto al que se mira al final del segmento)
//   ringId:      id del aro asociado (solo APPROACH y PASS_THROUGH)
export function createCameraPath(startId, targetIds) {
  if (!GameState.postsData[startId]) return [];
  const segments = [];

  const startPost = GameState.postsData[startId];

  // Punto de partida de la vuelta: altura de vuelo, preRingDistance antes
  // del poste de inicio (en la dirección opuesta a su normal).
  const startPoint = startPost.center.clone()
    .add(startPost.normal.clone().multiplyScalar(-CONFIG.preRingDistance));
  startPoint.y = CONFIG.height;

  // Precalcula before/after de cada aro objetivo.
  const ringData = targetIds.map(id => {
    const post = GameState.postsData[id];
    if (!post) return null;
    const direction = post.normal.clone();
    const before = post.center.clone()
      .add(direction.clone().multiplyScalar(-CONFIG.preRingDistance));
    before.y = post.center.y;
    const after = post.center.clone()
      .add(direction.clone().multiplyScalar(CONFIG.preRingDistance));
    after.y = post.center.y;
    return { post, before, after };
  }).filter(Boolean);

  if (ringData.length === 0) return [];

  // 1) APPROACH inicial: startPoint → before[0]
  //    La cámara desciende desde altura de vuelo hasta la altura del aro
  //    mientras mira fija al centro del primer aro objetivo.
  const firstRing = ringData[0];
  segments.push({
    type: 'APPROACH',
    start: startPoint.clone(),
    end: firstRing.before.clone(),
    length: startPoint.distanceTo(firstRing.before),
    lookAtStart: firstRing.post.center.clone(),
    lookAtEnd: firstRing.post.center.clone(),
    ringId: firstRing.post.id
  });

  // 2) Por cada aro, agrega PASS_THROUGH y (si no es el último) FLIGHT.
  for (let i = 0; i < ringData.length; i++) {
    const { post, before, after } = ringData[i];
    const straightAhead = straightAheadTarget(post);

    // PASS_THROUGH: before → after en línea recta. La cámara cruza el
    // centro del aro en la mitad del segmento. La mirada se mantiene fija
    // en straightAhead → no hay cabeceo dentro del aro.
    segments.push({
      type: 'PASS_THROUGH',
      start: before.clone(),
      end: after.clone(),
      length: before.distanceTo(after),
      lookAtStart: straightAhead.clone(),
      lookAtEnd: straightAhead.clone(),
      ringId: post.id
    });

    // FLIGHT al siguiente aro, modelado como 2 sub-segmentos rectos:
    //   FLIGHT_UP:   after[i] → apex    (sube a altura de vuelo)
    //   FLIGHT_DOWN: apex    → before[i+1] (baja a la altura del aro)
    // El ápice es el punto horizontal medio entre after[i] y before[i+1],
    // elevado a CONFIG.height. Esto elimina el riesgo de atravesar postes
    // altos en vuelo recto. La mirada se interpola linealmente entre
    // straightAhead del aro actual y el centro del siguiente aro a lo
    // largo de ambos sub-segmentos (sin recomputación por frame).
    if (i + 1 < ringData.length) {
      const next = ringData[i + 1];
      const apex = new THREE.Vector3(
        (after.x + next.before.x) / 2,
        CONFIG.height,
        (after.z + next.before.z) / 2
      );
      segments.push({
        type: 'FLIGHT_UP',
        start: after.clone(),
        end: apex.clone(),
        length: after.distanceTo(apex),
        lookAtStart: straightAhead.clone(),
        lookAtEnd: next.post.center.clone(),
        ringId: null
      });
      segments.push({
        type: 'FLIGHT_DOWN',
        start: apex.clone(),
        end: next.before.clone(),
        length: apex.distanceTo(next.before),
        lookAtStart: straightAhead.clone(),
        lookAtEnd: next.post.center.clone(),
        ringId: null
      });
    }
  }

  return segments;
}

function straightAheadTarget(ring) {
  return ring.center.clone().add(ring.normal.clone().multiplyScalar(LOOK_AHEAD));
}

// --- DRONE BALL: ruta con spline Catmull-Rom (mantiene tangente suave
//     para el trail ribbon). Es independiente del state machine del
//     jugador, ya que las bolas decorativas no necesitan la semántica
//     "approach / pass-through / flight" del gameplay. ---

// Detecta postes cercanos al segmento entre dos puntos
function findNearbyPostsOnPath(startPoint, endPoint, threshold = 3.0) {
  const nearbyPosts = [];
  for (const post of GameState.postsData) {
    const distance = pointToSegmentDistance(post.center, startPoint, endPoint);
    if (distance < threshold && distance > 0.1) {
      nearbyPosts.push({ post, distance, closestPoint: post.center.clone() });
    }
  }
  return nearbyPosts.sort((a, b) => a.distance - b.distance);
}

export function createSimpleSplinePath(startId, targetIds) {
  if (!GameState.postsData[startId]) return null;

  const points = [];
  const startPost = GameState.postsData[startId];

  const startPoint = startPost.center.clone();
  startPoint.y = CONFIG.height;
  points.push(startPoint);

  for (const id of targetIds) {
    const post = GameState.postsData[id];
    if (!post) continue;

    const lastPoint = points[points.length - 1];

    const approachMidPoint = new THREE.Vector3(
      (lastPoint.x + post.center.x) / 2,
      (lastPoint.y + post.center.y) / 2,
      (lastPoint.z + post.center.z) / 2
    );
    points.push(approachMidPoint);

    const nearbyPosts = findNearbyPostsOnPath(lastPoint, post.center, 4.0);
    for (const nearby of nearbyPosts) {
      if (nearby.post.id !== id && nearby.post.id !== startId) {
        const avoidancePoint = nearby.post.center.clone();
        avoidancePoint.y += Math.max(2, nearby.post.center.y + 2);
        points.push(avoidancePoint);
      }
    }

    const approachVector = new THREE.Vector3().subVectors(post.center, lastPoint);
    approachVector.y = 0;
    let direction = post.normal.clone();
    if (approachVector.normalize().dot(direction) < 0) direction.negate();

    const beforePoint = post.center.clone()
      .add(direction.clone().multiplyScalar(-CONFIG.preRingDistance));
    beforePoint.y = post.center.y;
    points.push(beforePoint);

    points.push(post.center.clone());

    const afterPoint = post.center.clone()
      .add(direction.clone().multiplyScalar(CONFIG.preRingDistance));
    afterPoint.y = post.center.y;
    points.push(afterPoint);

    const exitTransitionPoint = afterPoint.clone();
    exitTransitionPoint.y = CONFIG.height;
    points.push(exitTransitionPoint);
  }

  if (points.length < 2) return null;

  const curve = new THREE.CatmullRomCurve3(points);
  curve.curveType = 'chordal';
  curve.tension = CONFIG.splineTension;
  curve._cachedLength = curve.getLength();
  return curve;
}

// Helper visual: dibuja los segmentos como polilínea + esferas en los
// extremos. Se llama cuando CONFIG.showSpline está activo.
export function updateSplineHelper() {
  if (GameState.splineHelper) {
    GameState.scene.remove(GameState.splineHelper);
    GameState.splineHelper.geometry.dispose();
    GameState.splineHelper.material.dispose();
    GameState.splineHelper = null;
  }
  if (GameState.splinePoints) {
    GameState.splinePoints.forEach(sphere => {
      GameState.scene.remove(sphere);
      sphere.geometry.dispose();
      sphere.material.dispose();
    });
    GameState.splinePoints = [];
  }

  if (!CONFIG.showSpline) return;
  const segs = GameState.playerSegments;
  if (!segs || segs.length === 0) return;

  const points = [];
  segs.forEach((seg, i) => {
    if (i === 0) points.push(seg.start);
    points.push(seg.end);
  });
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
  GameState.splineHelper = new THREE.Line(geometry, material);
  GameState.scene.add(GameState.splineHelper);

  GameState.splinePoints = [];
  const sphereGeometry = new THREE.SphereGeometry(0.3, 16, 16);
  const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  points.forEach(pt => {
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.copy(pt);
    GameState.scene.add(sphere);
    GameState.splinePoints.push(sphere);
  });
}
