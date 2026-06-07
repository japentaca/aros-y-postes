import * as THREE from 'three';
import { GameState, updateStatus } from './Globals.js';
import { CONFIG } from './Config.js';
import { shuffle } from './Utils.js';
import { createSimpleSplinePath, updateSplineHelper } from './Spline.js';
import { FireEffect } from './effects/FireEffect.js';
import { LightBeacon } from './effects/LightBeacon.js';
import { CyberFireflies } from './effects/CyberFireflies.js';
import { DroneBall } from './entities/DroneBall.js';

// --- RING STATE CONSTANTS ---
const RING_STATE = {
  IDLE:    { color: 0xffaa00, emissive: 0x000000, glowOpacity: 0.06, discOpacity: 0.02 },
  ACTIVE:  { color: 0x0088ff, emissive: 0x004488, glowOpacity: 0.38, discOpacity: 0.12 },
  PASSED:  { color: 0xff0000, emissive: 0x550000, glowOpacity: 0.12, discOpacity: 0.02 }
};

// --- SHARED RESOURCES (kept at module level so we can dispose them on regenerate) ---
const sharedResources = {
  postGeometry: null,
  ringGeometry: null,
  glowRingGeometry: null,
  discGeometry: null,
  ringMaterial: null,
  glowRingMaterial: null,
  discMaterial: null,
  postsInstanced: null,
  ringsInstanced: null
};

function ensureSharedResources() {
  if (!sharedResources.postGeometry) {
    sharedResources.postGeometry = new THREE.CylinderGeometry(0.2, 0.2, 10, 12);
  }
  if (!sharedResources.ringGeometry) {
    sharedResources.ringGeometry = new THREE.TorusGeometry(1.5, 0.15, 16, 36);
  }
  if (!sharedResources.glowRingGeometry) {
    sharedResources.glowRingGeometry = new THREE.TorusGeometry(1.68, 0.38, 8, 36);
  }
  if (!sharedResources.discGeometry) {
    sharedResources.discGeometry = new THREE.CircleGeometry(1.4, 32);
  }
  if (!sharedResources.ringMaterial) {
    sharedResources.ringMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  }
  if (!sharedResources.glowRingMaterial) {
    sharedResources.glowRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
  }
  if (!sharedResources.discMaterial) {
    sharedResources.discMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.03,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
  }
}

function disposeSharedResources() {
  // Dispose InstancedMesh (frees instance buffers); geometry is shared
  if (sharedResources.postsInstanced) {
    GameState.postsGroup.remove(sharedResources.postsInstanced);
    sharedResources.postsInstanced.dispose();
    sharedResources.postsInstanced = null;
  }
  if (sharedResources.ringsInstanced) {
    GameState.postsGroup.remove(sharedResources.ringsInstanced);
    sharedResources.ringsInstanced.dispose();
    sharedResources.ringsInstanced = null;
  }
  // Geometries (truly shared — only created/destroyed once per app lifetime)
  if (sharedResources.postGeometry) { sharedResources.postGeometry.dispose(); sharedResources.postGeometry = null; }
  if (sharedResources.ringGeometry) { sharedResources.ringGeometry.dispose(); sharedResources.ringGeometry = null; }
  if (sharedResources.glowRingGeometry) { sharedResources.glowRingGeometry.dispose(); sharedResources.glowRingGeometry = null; }
  if (sharedResources.discGeometry) { sharedResources.discGeometry.dispose(); sharedResources.discGeometry = null; }
  // Materials
  if (sharedResources.ringMaterial) { sharedResources.ringMaterial.dispose(); sharedResources.ringMaterial = null; }
  if (sharedResources.glowRingMaterial) { sharedResources.glowRingMaterial.dispose(); sharedResources.glowRingMaterial = null; }
  if (sharedResources.discMaterial) { sharedResources.discMaterial.dispose(); sharedResources.discMaterial = null; }
}

// --- SCRATCH (used by setRingState) ---
const _scratchColor = new THREE.Color();

export function setRingState(post, state) {
  const def = RING_STATE[state];
  post.ringState = state;
  post.ringColor.setHex(def.color);
  post.ringEmissive.setHex(def.emissive);

  // Update InstancedMesh color
  if (sharedResources.ringsInstanced) {
    _scratchColor.setHex(def.color);
    sharedResources.ringsInstanced.setColorAt(post.id, _scratchColor);
    sharedResources.ringsInstanced.instanceColor.needsUpdate = true;
  }

  // Update ringProxy material (read by LightBeacon to detect ACTIVE state)
  if (post.ringProxy && post.ringProxy.material) {
    post.ringProxy.material.color.setHex(def.color);
    post.ringProxy.material.emissive.setHex(def.emissive);
  }

  // Update glow halo
  if (post.glowRing) {
    post.glowRing.material.color.setHex(def.color);
    post.glowRing.material.opacity = def.glowOpacity;
  }
  // Update energy disc
  if (post.disc) {
    post.disc.material.color.setHex(def.color);
    post.disc.material.opacity = def.discOpacity;
  }
  // Fire effect follows ring state
  if (state === 'ACTIVE') post.fireEffect.enable();
  else post.fireEffect.disable();
}

// Ajusta el emissive del material compartido de los aros (modo día/noche)
export function applyRingMaterialEmissive(isNight) {
  if (!sharedResources.ringMaterial) return;
  if (isNight) {
    sharedResources.ringMaterial.emissive.setHex(0xffffff);
    sharedResources.ringMaterial.emissiveIntensity = 2.0;
  } else {
    sharedResources.ringMaterial.emissive.setHex(0x000000);
    sharedResources.ringMaterial.emissiveIntensity = 1.0;
  }
}

export function resetFireflies() {
  if (GameState.fireflies) GameState.fireflies.dispose();
  GameState.fireflies = new CyberFireflies(CONFIG.firefliesCount, CONFIG.terrainSize);
  GameState.fireflies.setNightMode(CONFIG.isNight);
}

export function startPlayerRound(startId) {
  // Reset all posts to IDLE
  GameState.postsData.forEach(p => setRingState(p, 'IDLE'));

  const available = GameState.postsData.map(p => p.id).filter(id => id !== startId);
  GameState.playerPathIndices = shuffle(available);

  if (GameState.playerPathIndices.length === 0) {
    updateStatus("ERROR: NO HAY SUFICIENTES POSTES", "#ff0000");
    return;
  }

  // Mark first objective as ACTIVE
  GameState.playerCurrentTargetIdx = 0;
  const firstId = GameState.playerPathIndices[0];
  setRingState(GameState.postsData[firstId], 'ACTIVE');

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

  // --- DISPOSE PREVIOUS WORLD ---
  if (GameState.terrainMesh) {
    GameState.scene.remove(GameState.terrainMesh);
    GameState.terrainMesh.geometry.dispose();
    GameState.terrainMesh.material.dispose();
  }
  if (GameState.gridHelper) {
    GameState.scene.remove(GameState.gridHelper);
    GameState.gridHelper.geometry.dispose();
    GameState.gridHelper.material.dispose();
  }
  GameState.postsData.forEach(post => {
    if (post.fireEffect) post.fireEffect.dispose();
    if (post.beacon) post.beacon.dispose();
    // Las geometrías son compartidas; se disponen una vez en disposeSharedResources()
    if (post.glowRing) post.glowRing.material.dispose();
    if (post.disc) post.disc.material.dispose();
    if (post.ringProxy && post.ringProxy.parent) post.ringProxy.parent.remove(post.ringProxy);
  });
  GameState.postsData = [];

  GameState.ballsArray.forEach(b => {
    if (b.dispose) b.dispose();
  });
  GameState.ballsArray = [];

  // Dispose previous InstancedMesh + shared resources
  disposeSharedResources();
  ensureSharedResources();

  // Reiniciar Fireflies
  resetFireflies();

  // --- TERRAIN ---
  const planeGeo = new THREE.PlaneGeometry(CONFIG.terrainSize, CONFIG.terrainSize);
  const planeMat = new THREE.MeshStandardMaterial({ color: 0x55aa55, roughness: 0.8 });
  GameState.terrainMesh = new THREE.Mesh(planeGeo, planeMat);
  GameState.terrainMesh.rotation.x = -Math.PI / 2;
  GameState.terrainMesh.receiveShadow = true;
  GameState.terrainMesh.visible = !CONFIG.isNight;
  GameState.scene.add(GameState.terrainMesh);

  // Grid para Night Mode
  GameState.gridHelper = new THREE.GridHelper(CONFIG.terrainSize, CONFIG.terrainSize / 10, 0x00ffff, 0x003355);
  GameState.gridHelper.position.y = 0.1;
  GameState.gridHelper.visible = CONFIG.isNight;
  GameState.scene.add(GameState.gridHelper);

  if (CONFIG.isNight) {
    GameState.terrainMesh.material.color.setHex(0x000000);
  }

  // Re-aplicar tema al material de los postes
  if (CONFIG.isNight) {
    GameState.postMat.color.setHex(0x111111);
    GameState.postMat.emissive.setHex(0x4400cc);
    GameState.postMat.emissiveIntensity = 0.8;
  } else {
    GameState.postMat.color.setHex(0x888888);
    GameState.postMat.emissive.setHex(0x000000);
  }

  // --- INSTANCED MESH: POSTES ---
  const postsInstanced = new THREE.InstancedMesh(
    sharedResources.postGeometry,
    GameState.postMat,
    CONFIG.numPosts
  );
  postsInstanced.castShadow = true;
  postsInstanced.receiveShadow = true;
  postsInstanced.frustumCulled = false; // bounding sphere no incluye matrices; evitamos pop-out
  sharedResources.postsInstanced = postsInstanced;
  GameState.postsGroup.add(postsInstanced);

  // --- INSTANCED MESH: AROS ---
  const ringsInstanced = new THREE.InstancedMesh(
    sharedResources.ringGeometry,
    sharedResources.ringMaterial,
    CONFIG.numPosts
  );
  ringsInstanced.castShadow = true;
  ringsInstanced.frustumCulled = false;
  sharedResources.ringsInstanced = ringsInstanced;
  GameState.postsGroup.add(ringsInstanced);

  // --- DISTRIBUCIÓN DE POSTES ---
  const minDistance = 10;
  const maxRadius = CONFIG.terrainSize * 0.45;
  const postPositions = [];
  // Scratch para composición de matrices (reusados en el loop)
  const _postMatrix = new THREE.Matrix4();
  const _postPos = new THREE.Vector3();
  const _postQuat = new THREE.Quaternion();
  const _postScale = new THREE.Vector3();
  const _ringMatrix = new THREE.Matrix4();
  const _ringPos = new THREE.Vector3();
  const _ringQuat = new THREE.Quaternion();
  const _ringEuler = new THREE.Euler();
  const _ringScale = new THREE.Vector3(1, 1, 1);
  const _initialColor = new THREE.Color(0xffaa00);

  for (let i = 0; i < CONFIG.numPosts; i++) {
    let x, z;
    let attempts = 0;
    const maxAttempts = 100;

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

    postPositions.push({ x, z });
    const h = 1 + Math.random() * (CONFIG.maxPostHeight - 1);
    const ringY = h + 1.5 + 0.15;
    const ringRotY = Math.random() * Math.PI * 2;

    // Post instance matrix (CylinderGeometry es 10 unidades de alto por defecto)
    _postPos.set(x, h / 2, z);
    _postScale.set(1, h / 10, 1);
    _postMatrix.compose(_postPos, _postQuat, _postScale);
    postsInstanced.setMatrixAt(i, _postMatrix);

    // Ring instance matrix (position + Y rotation)
    _ringPos.set(x, ringY, z);
    _ringEuler.set(0, ringRotY, 0);
    _ringQuat.setFromEuler(_ringEuler);
    _ringMatrix.compose(_ringPos, _ringQuat, _ringScale);
    ringsInstanced.setMatrixAt(i, _ringMatrix);
    ringsInstanced.setColorAt(i, _initialColor);

    // Glow halo (per-post, sin batching — solo se ve en modo noche y cambia de color)
    const glowRing = new THREE.Mesh(sharedResources.glowRingGeometry, sharedResources.glowRingMaterial.clone());
    glowRing.position.set(x, ringY, z);
    glowRing.rotation.y = ringRotY;
    GameState.postsGroup.add(glowRing);

    // Energy disc
    const disc = new THREE.Mesh(sharedResources.discGeometry, sharedResources.discMaterial.clone());
    disc.position.set(x, ringY, z);
    disc.rotation.y = ringRotY;
    GameState.postsGroup.add(disc);

    // Normal del aro (vector en plano XZ perpendicular al aro)
    const normal = new THREE.Vector3(Math.sin(ringRotY), 0, Math.cos(ringRotY)).normalize();
    const center = new THREE.Vector3(x, ringY, z);

    // Fire effect + Light beacon
    // Las clases esperan un mesh con getWorldPosition y rotation.y. Como InstancedMesh
    // no soporta esas APIs, creamos un Object3D invisible que sirve de "ancla" lógica.
    const ringProxy = new THREE.Object3D();
    ringProxy.position.set(x, ringY, z);
    ringProxy.rotation.y = ringRotY;
    ringProxy.material = { color: new THREE.Color(0xffaa00), emissive: new THREE.Color(0x000000) };
    GameState.postsGroup.add(ringProxy);

    const fireEffect = new FireEffect(ringProxy);
    const beacon = new LightBeacon(ringProxy);
    beacon.mesh.position.copy(center);
    GameState.postsGroup.add(beacon.mesh);

    GameState.postsData.push({
      id: i,
      center: center,
      normal: normal,
      entry: center.clone().add(normal.clone().multiplyScalar(4)),
      exit: center.clone().sub(normal.clone().multiplyScalar(4)),
      ringProxy: ringProxy,        // Object3D invisible usado por FireEffect/LightBeacon
      ringState: 'IDLE',
      ringColor: new THREE.Color(0xffaa00),
      ringEmissive: new THREE.Color(0x000000),
      fireEffect: fireEffect,
      beacon: beacon,
      glowRing: glowRing,
      disc: disc
    });
  }

  postsInstanced.instanceMatrix.needsUpdate = true;
  ringsInstanced.instanceMatrix.needsUpdate = true;
  if (ringsInstanced.instanceColor) ringsInstanced.instanceColor.needsUpdate = true;

  if (GameState.postsData.length > 1) {
    const startNode = GameState.postsData[0];
    const startPos = startNode.center.clone().sub(startNode.normal.clone().multiplyScalar(15));
    startPos.y = CONFIG.height;
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
