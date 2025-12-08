import * as THREE from 'three';
import { GameState, updateStatus } from './Globals.js';
import { CONFIG } from './Config.js';
import { shuffle } from './Utils.js';
import { createSimpleSplinePath, updateSplineHelper } from './Spline.js';
import { FireEffect } from './effects/FireEffect.js';
import { LightBeacon } from './effects/LightBeacon.js';
import { CyberFireflies } from './effects/CyberFireflies.js';
import { DroneBall } from './entities/DroneBall.js';

export function resetFireflies() {
  if (GameState.fireflies) GameState.fireflies.dispose();
  GameState.fireflies = new CyberFireflies(CONFIG.firefliesCount, CONFIG.terrainSize);
  GameState.fireflies.setNightMode(CONFIG.isNight);
}

export function startPlayerRound(startId) {
  // Limpiar colores y desactivar todos los efectos de fuego
  GameState.postsData.forEach(p => {
    p.mesh.material.color.setHex(0xffaa00); // Amarillo
    p.mesh.material.emissive.setHex(0x000000);
    p.fireEffect.disable(); // Apagar fuego
  });

  const available = GameState.postsData.map(p => p.id).filter(id => id !== startId);
  GameState.playerPathIndices = shuffle(available);

  if (GameState.playerPathIndices.length === 0) {
    updateStatus("ERROR: NO HAY SUFICIENTES POSTES", "#ff0000");
    return;
  }

  // Marcar primer objetivo
  GameState.playerCurrentTargetIdx = 0;
  const firstId = GameState.playerPathIndices[0];
  GameState.postsData[firstId].mesh.material.color.setHex(0x0088ff); // Azul
  GameState.postsData[firstId].mesh.material.emissive.setHex(0x004488);
  GameState.postsData[firstId].fireEffect.enable(); // Encender fuego en el primer aro azul

  // Generar curva
  GameState.playerNextStartId = GameState.playerPathIndices[GameState.playerPathIndices.length - 1];
  GameState.playerCurve = createSimpleSplinePath(startId, GameState.playerPathIndices);
  GameState.playerProgress = 0;

  // Actualizar helper visual de la spline
  updateSplineHelper();

  updateStatus(`OBJETIVOS: ${GameState.playerPathIndices.length}`, "#44aaff");
}

export function generateWorld() {
  updateStatus("GENERANDO MUNDO...", "#ffff00");

  if (GameState.terrainMesh) {
    GameState.scene.remove(GameState.terrainMesh);
    GameState.terrainMesh.geometry.dispose();
  }
  while (GameState.postsGroup.children.length > 0) {
    GameState.postsGroup.remove(GameState.postsGroup.children[0]);
  }

  // Dispose of all fire effects from previous world to prevent ghost particles
  GameState.postsData.forEach(post => {
    if (post.fireEffect) {
      post.fireEffect.dispose();
    }
  });

  GameState.postsData = [];

  // Dispose of old drones and trails
  GameState.ballsArray.forEach(b => {
    if (b.dispose) b.dispose();
  });
  GameState.ballsArray = [];

  // Reiniciar Fireflies
  resetFireflies();

  // Terreno
  const planeGeo = new THREE.PlaneGeometry(CONFIG.terrainSize, CONFIG.terrainSize);
  const planeMat = new THREE.MeshStandardMaterial({ color: 0x55aa55, roughness: 0.8 });
  GameState.terrainMesh = new THREE.Mesh(planeGeo, planeMat);
  GameState.terrainMesh.rotation.x = -Math.PI / 2;
  GameState.terrainMesh.receiveShadow = true;
  GameState.terrainMesh.visible = !CONFIG.isNight; // Initial visibility
  GameState.scene.add(GameState.terrainMesh);

  // Grid para Night Mode
  if (GameState.gridHelper) {
    GameState.scene.remove(GameState.gridHelper);
    GameState.gridHelper.geometry.dispose();
  }
  // GridHelper( size, divisions, colorCenterLine, colorGrid )
  GameState.gridHelper = new THREE.GridHelper(CONFIG.terrainSize, CONFIG.terrainSize / 10, 0x00ff00, 0x004400);
  GameState.gridHelper.position.y = 0.1;
  GameState.gridHelper.visible = CONFIG.isNight;
  GameState.scene.add(GameState.gridHelper);

  // Re-aplicar tema al generar nuevo mundo si estamos en modo noche
  if (CONFIG.isNight) {
    // No necesitamos cambiar material del terreno porque está invisible
    GameState.terrainMesh.material.color.setHex(0x000000);
  }

  // Postes
  const postGeo = new THREE.CylinderGeometry(0.2, 0.2, 10, 8);
  const ringGeo = new THREE.TorusGeometry(1.5, 0.15, 8, 24);
  // postMat is global in GameState

  // Re-aplicar tema al material de los postes
  if (CONFIG.isNight) {
    GameState.postMat.color.setHex(0x111111);
    GameState.postMat.emissive.setHex(0x4400cc);
    GameState.postMat.emissiveIntensity = 0.8;
  }

  const ringMatBase = new THREE.MeshStandardMaterial({ color: 0xffaa00 });

  // Algoritmo de distribución con distancia mínima
  const minDistance = 10; // Distancia mínima entre postes en metros
  const maxRadius = CONFIG.terrainSize * 0.45; // 45% del tamaño del terreno para evitar bordes
  const postPositions = [];

  for (let i = 0; i < CONFIG.numPosts; i++) {
    let x, z;
    let attempts = 0;
    const maxAttempts = 100;

    // Intentar encontrar una posición válida
    do {
      const radius = Math.random() * maxRadius;
      const angle = Math.random() * Math.PI * 2;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
      attempts++;
    } while (attempts < maxAttempts && postPositions.some(pos => {
      const distance = Math.sqrt((x - pos.x) ** 2 + (z - pos.z) ** 2);
      return distance < minDistance;
    }));

    // Si no se encontró una posición válida, usar la última generada
    postPositions.push({ x, z });
    const h = 1 + Math.random() * (CONFIG.maxPostHeight - 1); // Altura aleatoria entre 1 y maxPostHeight metros

    const post = new THREE.Mesh(postGeo, GameState.postMat);
    post.scale.y = h / 10;
    post.position.set(x, h / 2, z);
    post.castShadow = true;
    GameState.postsGroup.add(post);

    const ring = new THREE.Mesh(ringGeo, ringMatBase.clone());
    const ringY = h + 1.5 + 0.15;
    ring.position.set(x, ringY, z);
    ring.rotation.y = Math.random() * Math.PI * 2;
    GameState.postsGroup.add(ring);

    // Calcular vector normal que apunta en la dirección "hacia adelante" del aro
    // El aro está en el plano XY, así que rotamos un vector en el plano XZ
    const angle = ring.rotation.y;
    const normal = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).normalize();

    const center = new THREE.Vector3(x, ringY, z);

    // Create fire effect for this hoop
    const fireEffect = new FireEffect(ring);

    // Create Light Beacon for this hoop
    const beacon = new LightBeacon(ring);
    beacon.mesh.position.copy(center);

    GameState.postsGroup.add(beacon.mesh);

    GameState.postsData.push({
      id: i,
      center: center,
      normal: normal,
      entry: center.clone().add(normal.clone().multiplyScalar(4)),
      exit: center.clone().sub(normal.clone().multiplyScalar(4)),
      mesh: ring,
      fireEffect: fireEffect,
      beacon: beacon
    });
  }

  if (GameState.postsData.length > 1) {
    const startNode = GameState.postsData[0];
    const startPos = startNode.center.clone().sub(startNode.normal.clone().multiplyScalar(15));
    startPos.y = CONFIG.height; // Usar la altura de vuelo configurada, no la altura del aro
    GameState.camera.position.copy(startPos);
    GameState.camera.lookAt(startNode.center);

    startPlayerRound(0);
  }

  for (let i = 0; i < CONFIG.numBalls; i++) {
    const color = new THREE.Color().setHSL(Math.random(), 0.8, 0.5);
    const startId = (i + 1) % CONFIG.numPosts;
    GameState.ballsArray.push(new DroneBall(color, startId));
  }
}
