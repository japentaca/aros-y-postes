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

let lookDir = new THREE.Vector3(0, 0, -1);
let lookDirReady = false;
const BIRD_TURN = 0.8; // rad/s — lower = slower bird-like head turns
const MAX_DELTA = 0.1; // clamp deltaTime to avoid jumps when tab regains focus

// --- SCRATCH OBJECTS (reused every frame to avoid GC pressure) ---
const _scratchDesiredDir = new THREE.Vector3();
const _scratchRingNormal = new THREE.Vector3();
const _scratchCurrentDist = new THREE.Vector3();
const _scratchPreviousDist = new THREE.Vector3();
const _scratchLookTarget = new THREE.Vector3();

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

// --- ANIMATION LOOP ---
function animate() {
  requestAnimationFrame(animate);

  if (GameState.playerCurve) {
    const len = GameState.playerCurve._cachedLength ?? GameState.playerCurve.getLength();
    if (len > 1) {
      const step = CONFIG.speed / len;
      GameState.playerProgress += step;

      if (GameState.playerProgress >= 1) {
        lookDirReady = false;
        startPlayerRound(GameState.playerNextStartId);
      } else {
        const pos = GameState.playerCurve.getPointAt(GameState.playerProgress);
        GameState.camera.position.copy(pos);

        // Bird-like head turn: smoothly rotate toward the current target ring
        if (GameState.playerCurrentTargetIdx < GameState.playerPathIndices.length) {
          const id = GameState.playerPathIndices[GameState.playerCurrentTargetIdx];
          _scratchDesiredDir.subVectors(GameState.postsData[id].center, pos).normalize();
        } else {
          _scratchDesiredDir.copy(lookDir); // hold heading when lap ends
        }
        if (!lookDirReady) { lookDir.copy(_scratchDesiredDir); lookDirReady = true; }
        const frameMs = performance.now() - lastFrameTime;
        const alpha = 1 - Math.exp(-BIRD_TURN * frameMs / 1000);
        lookDir.lerp(_scratchDesiredDir, alpha).normalize();
        _scratchLookTarget.copy(pos).addScaledVector(lookDir, 100);
        GameState.camera.lookAt(_scratchLookTarget);

        if (GameState.playerCurrentTargetIdx < GameState.playerPathIndices.length) {
          const targetId = GameState.playerPathIndices[GameState.playerCurrentTargetIdx];
          const target = GameState.postsData[targetId];

          // Calcular distancia al aro actual
          const distanceToRing = GameState.camera.position.distanceTo(target.center);

          // DETECCIÓN DE CRUCE: Verificar cruce de plano del aro
          const ringNormal = target.normal;
          const ringCenter = target.center;

          // Calcular distancias firmadas al plano del aro (reused scratch vectors)
          const currentDist = _scratchCurrentDist.subVectors(GameState.camera.position, ringCenter).dot(ringNormal);
          const previousDist = _scratchPreviousDist.subVectors(previousCameraPosition, ringCenter).dot(ringNormal);

          // Detectar cruce: los signos de las distancias deben ser diferentes
          const crossedPlane = (currentDist * previousDist) < 0;

          // Verificar que el cruce ocurrió cerca del centro del aro (dentro del radio)
          const ringRadius = 1.5; // Radio del aro

          // Si cruzamos el plano Y estamos dentro del radio del aro
          if (crossedPlane && distanceToRing < ringRadius * 1.2) {

            // Ring crossing flash
            const flashEl = document.getElementById('ring-flash');
            if (flashEl) {
              flashEl.style.transition = 'none';
              flashEl.style.opacity = '1';
              requestAnimationFrame(() => {
                flashEl.style.transition = 'opacity 0.5s ease-out';
                flashEl.style.opacity = '0';
              });
            }

            // Marcar aro actual como pasado (rojo) y apagar fuego
            setRingState(target, 'PASSED');

            // Avanzar al siguiente aro
            GameState.playerCurrentTargetIdx++;
            const left = GameState.playerPathIndices.length - GameState.playerCurrentTargetIdx;
            updateStatus(`PENDIENTES: ${left}`, "#44aaff");

            // Highlight next ring — smoothedLookAt will naturally drift toward it
            if (GameState.playerCurrentTargetIdx < GameState.playerPathIndices.length) {
              const nextId = GameState.playerPathIndices[GameState.playerCurrentTargetIdx];
              setRingState(GameState.postsData[nextId], 'ACTIVE');
            } else {
              updateStatus("¡VUELTA TERMINADA!", "#00ff00");
            }
          }
        }
      }
    }
  }

  GameState.ballsArray.forEach(b => {
    b.update();
  });

  // Calcular deltaTime para animación de partículas
  const currentTime2 = performance.now();
  let deltaTime;
  if (lastFrameTime < 0) {
    deltaTime = 1 / 60; // primer frame: usar valor razonable
  } else {
    deltaTime = (currentTime2 - lastFrameTime) / 1000;
  }
  lastFrameTime = currentTime2;
  if (deltaTime > MAX_DELTA) deltaTime = MAX_DELTA; // clamp para evitar saltos al cambiar pestaña

  // Update player light position
  playerLight.position.copy(GameState.camera.position);

  // Actualizar efectos de fuego y Beacons (glow halos y discs se actualizan via setRingState)
  GameState.postsData.forEach(p => {
    p.fireEffect.update(deltaTime);
    if (p.beacon) p.beacon.update(deltaTime);
  });

  // Actualizar Fireflies
  if (GameState.fireflies) GameState.fireflies.update(currentTime2 / 1000, deltaTime);

  // Actualizar contador de FPS
  updateFPS();

  // Actualizar posición previa de la cámara para detección de cruce en el siguiente frame
  previousCameraPosition.copy(GameState.camera.position);

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
