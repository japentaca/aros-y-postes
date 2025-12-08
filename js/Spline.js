import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { GameState } from './Globals.js';
import { pointToSegmentDistance } from './Utils.js';

// Función para detectar postes cercanos al camino entre dos puntos
export function findNearbyPostsOnPath(startPoint, endPoint, threshold = 3.0) {
  const nearbyPosts = [];

  for (let post of GameState.postsData) {
    const distance = pointToSegmentDistance(post.center, startPoint, endPoint);
    if (distance < threshold && distance > 0.1) { // Excluir postes de inicio/fin
      nearbyPosts.push({
        post: post,
        distance: distance,
        closestPoint: post.center.clone()
      });
    }
  }

  return nearbyPosts.sort((a, b) => a.distance - b.distance);
}

// Crear curva de vuelo simplificada con splines
export function createSimpleSplinePath(startId, targetIds) {
  if (!GameState.postsData[startId]) return null;

  const points = [];
  const startPost = GameState.postsData[startId];

  // Punto inicial - posición elevada cerca del poste de inicio
  const startPoint = startPost.center.clone();
  startPoint.y = CONFIG.height; // Usar directamente la altura configurada
  points.push(startPoint);

  for (let id of targetIds) {
    const post = GameState.postsData[id];
    if (!post) continue;

    // Obtener el último punto agregado
    const lastPoint = points[points.length - 1];

    // Crear punto de descenso a la mitad de camino al aro
    const approachMidPoint = new THREE.Vector3(
      (lastPoint.x + post.center.x) / 2,
      (lastPoint.y + post.center.y) / 2,
      (lastPoint.z + post.center.z) / 2
    );
    points.push(approachMidPoint);

    // Detectar postes cercanos al camino entre el último punto y este poste
    const nearbyPosts = findNearbyPostsOnPath(lastPoint, post.center, 4.0); // Umbral de 4 metros

    // Agregar puntos de desvío para postes en el camino
    for (let nearby of nearbyPosts) {
      // Si el poste cercano no es el destino actual ni el de origen
      if (nearby.post.id !== id && nearby.post.id !== startId) {

        // Crear punto de desvío 2 metros por encima del poste
        const avoidancePoint = nearby.post.center.clone();
        avoidancePoint.y += Math.max(2, nearby.post.center.y + 2); // Asegurar que el punto de desvío esté por encima del poste
        points.push(avoidancePoint);
      }
    }

    // CAMBIO: Usar el normal del aro pero elegir el lado correcto según la aproximación
    // Calcular vector de aproximación desde el último punto hacia el aro
    const approachVector = new THREE.Vector3().subVectors(post.center, lastPoint);
    approachVector.y = 0; // Proyectar al plano horizontal

    // Usar el normal del aro (perpendicular al plano del aro)
    let direction = post.normal.clone();

    // Determinar si debemos invertir el normal basándonos en el lado de aproximación
    // Si el dot product es negativo, estamos aproximando desde el lado opuesto al normal
    const dotProduct = approachVector.normalize().dot(direction);
    if (dotProduct < 0) {
      // Invertir la dirección para aproximar desde el otro lado
      direction.negate();
    }

    // Punto ANTES del aro (approach) - a la misma altura del aro
    const beforePoint = post.center.clone()
      .add(direction.clone().multiplyScalar(-CONFIG.preRingDistance)); // Usar valor del slider
    // Mantener la altura del aro para alinearse correctamente
    beforePoint.y = post.center.y;
    points.push(beforePoint);

    // Punto en el CENTRO del aro - mantener altura del aro para pasar correctamente
    points.push(post.center.clone());

    // Punto DESPUÉS del aro (exit) - a la misma altura del aro
    const afterPoint = post.center.clone()
      .add(direction.clone().multiplyScalar(CONFIG.preRingDistance)); // Usar valor del slider
    // Mantener la altura del aro para una transición suave
    afterPoint.y = post.center.y;
    points.push(afterPoint);

    // Crear punto de ascenso a la altura de vuelo para el siguiente segmento
    const exitTransitionPoint = afterPoint.clone();
    exitTransitionPoint.y = CONFIG.height;
    points.push(exitTransitionPoint);
  }

  if (points.length < 2) return null;

  // Crear spline suave con Catmull-Rom
  const curve = new THREE.CatmullRomCurve3(points);
  curve.curveType = CONFIG.curveType;
  curve.tension = CONFIG.splineTension; // Usar la tensión configurada
  return curve;
}

// Helper visual de la spline
export function updateSplineHelper() {
  // Limpiar helper anterior
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

  // Si está activado y hay una curva, crear el helper
  if (CONFIG.showSpline && GameState.playerCurve) {
    // Crear línea de la spline
    const points = GameState.playerCurve.getPoints(100);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xff0000,
      linewidth: 2
    });
    GameState.splineHelper = new THREE.Line(geometry, material);
    GameState.scene.add(GameState.splineHelper);

    // Crear puntos de control
    GameState.splinePoints = [];
    const controlPoints = GameState.playerCurve.points;
    controlPoints.forEach(point => {
      const sphereGeometry = new THREE.SphereGeometry(0.3, 16, 16);
      const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
      sphere.position.copy(point);
      GameState.scene.add(sphere);
      GameState.splinePoints.push(sphere);
    });
  }
}
