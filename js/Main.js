import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { GameState, updateStatus } from './Globals.js';
import { setupSkybox, updateTheme } from './Theme.js';
import { generateWorld, startPlayerRound, resetFireflies, setRingState } from './World.js';
import { updateSplineHelper } from './Spline.js';

// --- INITIALIZATION ---
GameState.statusEl = document.getElementById('status-pill');

// Scene Setup
GameState.scene = new THREE.Scene();
GameState.scene.background = new THREE.Color(0x87CEEB);

GameState.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
GameState.renderer = new THREE.WebGLRenderer({ antialias: true });
GameState.renderer.setSize(window.innerWidth, window.innerHeight);
GameState.renderer.shadowMap.enabled = true;
document.body.appendChild(GameState.renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
GameState.scene.add(ambientLight);
const playerLight = new THREE.PointLight(0x88ccff, 3, 50);
GameState.scene.add(playerLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(100, 200, 100);
dirLight.castShadow = true;
// Frustum ajustado al tamaño del terreno (era ±1000 para 300m → 1 texel/unidad)
// Ajustamos a CONFIG.terrainSize * 0.6 para tener buena cobertura con margen
const shadowHalf = CONFIG.terrainSize * 0.6;
dirLight.shadow.camera.left = -shadowHalf;
dirLight.shadow.camera.right = shadowHalf;
dirLight.shadow.camera.top = shadowHalf;
dirLight.shadow.camera.bottom = -shadowHalf;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
GameState.scene.add(dirLight);

// Groups
GameState.scene.add(GameState.postsGroup);

// Initial Skybox
setupSkybox('./skybox.jpeg');

// --- VARIABLES FOR LOOP ---
let frameCount = 0;
let lastTime = performance.now();
let fps = 0;
let lastFrameTime = -1; // -1 forces initialization on first frame
let previousCameraPosition = new THREE.Vector3();
const MAX_DELTA = 0.1; // clamp deltaTime to avoid jumps when tab regains focus

// --- SCRATCH OBJECTS (reused every frame to avoid GC pressure) ---
const _scratchPos = new THREE.Vector3();
const _scratchLookAt = new THREE.Vector3();
const _scratchCurrentDist = new THREE.Vector3();
const _scratchPreviousDist = new THREE.Vector3();
const _scratchTotalLength = { v: 0 }; // cache total length across frames

// --- FPS COUNTER ---
function updateFPS() {
  frameCount++;
  const currentTime = performance.now();
  const deltaTime = currentTime - lastTime;

  if (deltaTime >= 1000) {
    fps = Math.round((frameCount * 1000) / deltaTime);
    const fpsEl = document.getElementById('fps-value');
    if (fpsEl) fpsEl.textContent = fps;
    frameCount = 0;
    lastTime = currentTime;
  }
}

// --- CAMERA TRAVERSAL (state machine sobre segmentos) ---
//
// Modelo: una vuelta es una secuencia de segmentos rectos
// (APPROACH / PASS_THROUGH / FLIGHT_UP / FLIGHT_DOWN). El punto de mirada
// se interpola linealmente entre lookAtStart y lookAtEnd de cada segmento,
// por lo que NO se recalcula un "vector deseado" cada frame: la dirección
// de mirada es continua y determinística por fase.
//
// Velocidad: CONFIG.speed se interpreta como "fracción del recorrido total
// recorrida por frame" (mismo criterio que la versión basada en spline).
function advancePlayer(dt) {
  const segs = GameState.playerSegments;
  if (!segs || segs.length === 0) return;

  // Cachea el largo total mientras no cambien los segmentos
  if (_scratchTotalLength.v === 0) {
    for (const s of segs) _scratchTotalLength.v += s.length;
  }
  const totalLength = _scratchTotalLength.v;
  if (totalLength <= 0) return;

  // dt en ms aprox (60fps ≈ 16.67). step = fracción del recorrido / frame.
  const step = (CONFIG.speed / totalLength) * (dt * 60);
  const advanceUnits = step * segs[GameState.playerSegmentIdx].length;
  GameState.playerSegmentProgress += advanceUnits;

  // Avanza segmentos si el progreso se pasa del actual
  while (GameState.playerSegmentProgress >= segs[GameState.playerSegmentIdx].length) {
    const overflow = GameState.playerSegmentProgress - segs[GameState.playerSegmentIdx].length;
    GameState.playerSegmentIdx++;
    GameState.playerSegmentProgress = overflow;
    if (GameState.playerSegmentIdx >= segs.length) {
      // Vuelta terminada: reset de cache y arranque de la siguiente
      _scratchTotalLength.v = 0;
      startPlayerRound(GameState.playerNextStartId);
      return;
    }
  }

  // Posición: interpolación lineal sobre el segmento actual
  const seg = segs[GameState.playerSegmentIdx];
  const t = GameState.playerSegmentProgress / seg.length;
  _scratchPos.lerpVectors(seg.start, seg.end, t);
  GameState.camera.position.copy(_scratchPos);

  // LookAt: interpolación lineal entre los anclas de mirada del segmento.
  // Para APPROACH/PASS_THROUGH son iguales (mirada fija); para FLIGHT_*
  // interpolan suavemente entre el "recto" del aro actual y el centro del
  // siguiente aro. Sin lerp追逐 por frame.
  _scratchLookAt.lerpVectors(seg.lookAtStart, seg.lookAtEnd, t);
  GameState.camera.lookAt(_scratchLookAt);
}

function detectRingCrossing() {
  if (GameState.playerCurrentTargetIdx >= GameState.playerPathIndices.length) return;
  const target = GameState.postsData[GameState.playerPathIndices[GameState.playerCurrentTargetIdx]];

  const currentDist = _scratchCurrentDist.subVectors(GameState.camera.position, target.center).dot(target.normal);
  const previousDist = _scratchPreviousDist.subVectors(previousCameraPosition, target.center).dot(target.normal);
  const crossedPlane = (currentDist * previousDist) < 0;
  if (!crossedPlane) return;

  const ringRadius = 1.5;
  const distanceToRing = GameState.camera.position.distanceTo(target.center);
  if (distanceToRing >= ringRadius * 1.2) return;

  // Cruce válido: marcar aro actual como pasado y activar el siguiente
  const flashEl = document.getElementById('ring-flash');
  if (flashEl) {
    flashEl.style.transition = 'none';
    flashEl.style.opacity = '1';
    requestAnimationFrame(() => {
      flashEl.style.transition = 'opacity 0.5s ease-out';
      flashEl.style.opacity = '0';
    });
  }
  setRingState(target, 'PASSED');
  GameState.playerCurrentTargetIdx++;
  const left = GameState.playerPathIndices.length - GameState.playerCurrentTargetIdx;
  if (left > 0) {
    updateStatus(`PENDIENTES: ${left}`, "#44aaff");
    const nextId = GameState.playerPathIndices[GameState.playerCurrentTargetIdx];
    setRingState(GameState.postsData[nextId], 'ACTIVE');
  } else {
    updateStatus("¡VUELTA TERMINADA!", "#00ff00");
  }
}

// --- ANIMATION LOOP ---
function animate() {
  requestAnimationFrame(animate);

  // Calcular deltaTime para integración y para animaciones de partículas
  const currentTime = performance.now();
  let deltaTime;
  if (lastFrameTime < 0) {
    deltaTime = 1 / 60; // primer frame: valor razonable
  } else {
    deltaTime = (currentTime - lastFrameTime) / 1000;
  }
  lastFrameTime = currentTime;
  if (deltaTime > MAX_DELTA) deltaTime = MAX_DELTA; // clamp al cambiar pestaña

  // 1) Cámara: el orden importa.
  //    a) Guardar la posición actual como "anterior" (de este frame).
  //    b) Avanzar el segmento, que cambia la posición.
  //    c) Detectar cruce comparando la nueva posición con la guardada.
  previousCameraPosition.copy(GameState.camera.position);
  advancePlayer(deltaTime);
  detectRingCrossing();

  // 2) Bots
  GameState.ballsArray.forEach(b => b.update());

  // 3) Update player light position
  playerLight.position.copy(GameState.camera.position);

  // 4) Efectos de fuego y beacons
  GameState.postsData.forEach(p => {
    p.fireEffect.update(deltaTime);
    if (p.beacon) p.beacon.update(deltaTime);
  });

  // 5) Fireflies
  if (GameState.fireflies) GameState.fireflies.update(currentTime / 1000, deltaTime);

  // 6) FPS
  updateFPS();

  GameState.renderer.render(GameState.scene, GameState.camera);
}

// --- UI EVENT LISTENERS ---

// Helper to trigger reload
let timer;
const triggerReload = () => {
  clearTimeout(timer);
  timer = setTimeout(generateWorld, 500);
};

let firefliesTimer;
const triggerFirefliesUpdate = () => {
  clearTimeout(firefliesTimer);
  firefliesTimer = setTimeout(() => {
    resetFireflies();
  }, 300);
};

// Toggle Panel
const toggleBtn = document.getElementById('toggle-btn');
const toggleHeader = document.getElementById('toggle-header');
const controlsPanel = document.getElementById('controls');

if (toggleHeader && controlsPanel) {
  toggleHeader.addEventListener('click', () => {
    controlsPanel.classList.toggle('collapsed');
  });
}

// Sliders
document.getElementById('sl-speed').oninput = (e) => {
  CONFIG.speed = parseFloat(e.target.value);
  document.getElementById('v-speed').innerText = CONFIG.speed;
};
document.getElementById('sl-height').oninput = (e) => {
  CONFIG.height = parseFloat(e.target.value);
  document.getElementById('v-height').innerText = CONFIG.height;
};
document.getElementById('sl-terrain').oninput = (e) => {
  CONFIG.terrainSize = parseInt(e.target.value);
  document.getElementById('v-terrain').innerText = CONFIG.terrainSize;
  triggerReload();
};
document.getElementById('sl-posts').oninput = (e) => {
  CONFIG.numPosts = parseInt(e.target.value);
  document.getElementById('v-posts').innerText = CONFIG.numPosts;
  triggerReload();
};
document.getElementById('sl-balls').oninput = (e) => {
  CONFIG.numBalls = parseInt(e.target.value);
  document.getElementById('v-balls').innerText = CONFIG.numBalls;
  triggerReload();
};
document.getElementById('sl-preRingDistance').oninput = (e) => {
  CONFIG.preRingDistance = parseInt(e.target.value);
  document.getElementById('v-preRingDistance').innerText = CONFIG.preRingDistance;
  triggerReload();
};
document.getElementById('sl-maxPostHeight').oninput = (e) => {
  CONFIG.maxPostHeight = parseFloat(e.target.value);
  document.getElementById('v-maxPostHeight').innerText = CONFIG.maxPostHeight;
  triggerReload();
};
// Checkboxes
document.getElementById('chk-theme').onchange = (e) => {
  CONFIG.isNight = e.target.checked;
  updateTheme(ambientLight, dirLight);
};
document.getElementById('chk-spline').onchange = (e) => {
  CONFIG.showSpline = e.target.checked;
  updateSplineHelper();
};

document.getElementById('sl-fireflies').oninput = (e) => {
  CONFIG.firefliesCount = parseInt(e.target.value);
  document.getElementById('v-fireflies').innerText = CONFIG.firefliesCount;
  triggerFirefliesUpdate();
};

// Window Resize
window.onresize = () => {
  GameState.camera.aspect = window.innerWidth / window.innerHeight;
  GameState.camera.updateProjectionMatrix();
  GameState.renderer.setSize(window.innerWidth, window.innerHeight);
};

// Start
generateWorld();

// Init Display Values
document.getElementById('v-preRingDistance').innerText = CONFIG.preRingDistance;
document.getElementById('v-maxPostHeight').innerText = CONFIG.maxPostHeight;

animate();
