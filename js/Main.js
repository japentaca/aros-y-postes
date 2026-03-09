import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { GameState, updateStatus } from './Globals.js';
import { setupSkybox, updateTheme } from './Theme.js';
import { generateWorld, startPlayerRound, resetFireflies } from './World.js';
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
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(100, 200, 100);
dirLight.castShadow = true;
dirLight.shadow.camera.left = -1000;
dirLight.shadow.camera.right = 1000;
dirLight.shadow.camera.top = 1000;
dirLight.shadow.camera.bottom = -1000;
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
let lastFrameTime = performance.now();
let previousCameraPosition = new THREE.Vector3();

// Smoothed camera look-at: we smooth the DIRECTION (unit vector) from the camera
// to the target, not the absolute world position. This ensures the camera always
// looks forward — interpolating world positions breaks when the old target is behind.
let smoothedLookDir = new THREE.Vector3(0, 0, -1); // unit vector, starts pointing forward
let smoothedLookInitialized = false;
const LOOK_AT_SPEED = 0.5; // radians/sec feel. 0.5 = slow bird-like head turn

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
    const len = GameState.playerCurve.getLength();
    if (len > 1) {
      const step = CONFIG.speed / len;
      GameState.playerProgress += step;

      if (GameState.playerProgress >= 1) {
        smoothedLookInitialized = false; // Reset so next round snaps to first ring
        startPlayerRound(GameState.playerNextStartId);
      } else {
        // Movimiento
        const pos = GameState.playerCurve.getPointAt(GameState.playerProgress);
        GameState.camera.position.copy(pos);

        // Smooth camera look direction — compute the raw direction TO the current target
        // from the camera's CURRENT position, then slerp toward it.
        const currentTime = performance.now();
        const rawLookTarget = new THREE.Vector3();
        if (GameState.playerCurrentTargetIdx < GameState.playerPathIndices.length) {
          const targetId = GameState.playerPathIndices[GameState.playerCurrentTargetIdx];
          rawLookTarget.copy(GameState.postsData[targetId].center);
        } else {
          const lookAheadT = Math.min(GameState.playerProgress + (5.0 / len), 1);
          rawLookTarget.copy(GameState.playerCurve.getPointAt(lookAheadT));
        }

        // Direction from camera to target, recomputed every frame from current position
        const rawDir = rawLookTarget.clone().sub(GameState.camera.position).normalize();

        if (!smoothedLookInitialized) {
          smoothedLookDir.copy(rawDir);
          smoothedLookInitialized = true;
        }
        const frameMs = currentTime - lastFrameTime;
        const alpha = 1 - Math.exp(-LOOK_AT_SPEED * frameMs / 1000);
        // Lerp + renormalize approximates slerp for the small per-frame angles here
        smoothedLookDir.lerp(rawDir, alpha).normalize();

        GameState.camera.lookAt(GameState.camera.position.clone().add(smoothedLookDir.clone().multiplyScalar(100)));

        if (GameState.playerCurrentTargetIdx < GameState.playerPathIndices.length) {
          const targetId = GameState.playerPathIndices[GameState.playerCurrentTargetIdx];
          const target = GameState.postsData[targetId];

          // Calcular distancia al aro actual
          const distanceToRing = GameState.camera.position.distanceTo(target.center);

          // DETECCIÓN DE CRUCE: Verificar cruce de plano del aro
          const ringNormal = target.normal.clone();
          const ringCenter = target.center;

          // Calcular distancias firmadas al plano del aro
          const currentDist = new THREE.Vector3().subVectors(GameState.camera.position, ringCenter).dot(ringNormal);
          const previousDist = new THREE.Vector3().subVectors(previousCameraPosition, ringCenter).dot(ringNormal);

          // Detectar cruce: los signos de las distancias deben ser diferentes
          const crossedPlane = (currentDist * previousDist) < 0;

          // Verificar que el cruce ocurrió cerca del centro del aro (dentro del radio)
          const ringRadius = 1.5; // Radio del aro

          // Si cruzamos el plano Y estamos dentro del radio del aro
          if (crossedPlane && distanceToRing < ringRadius * 1.2) {

            // Marcar aro actual como pasado (rojo) y apagar fuego
            target.mesh.material.color.setHex(0xff0000);
            target.mesh.material.emissive.setHex(0x550000);
            target.fireEffect.disable();

            // Avanzar al siguiente aro
            GameState.playerCurrentTargetIdx++;
            const left = GameState.playerPathIndices.length - GameState.playerCurrentTargetIdx;
            updateStatus(`PENDIENTES: ${left}`, "#44aaff");

            // Highlight next ring — smoothedLookAt will naturally drift toward it
            if (GameState.playerCurrentTargetIdx < GameState.playerPathIndices.length) {
              const nextId = GameState.playerPathIndices[GameState.playerCurrentTargetIdx];
              GameState.postsData[nextId].mesh.material.color.setHex(0x0088ff);
              GameState.postsData[nextId].mesh.material.emissive.setHex(0x004488);
              GameState.postsData[nextId].fireEffect.enable();
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
    // En modo noche, asegurar que el brillo sigue el color
    if (CONFIG.isNight) {
      b.mesh.material.emissive.copy(b.mesh.material.color);
    }
  });

  // Calcular deltaTime para animación de partículas
  const currentTime2 = performance.now();
  const deltaTime = (currentTime2 - lastFrameTime) / 1000; // Convertir a segundos
  lastFrameTime = currentTime2;

  // Actualizar efectos de fuego Y Beacons
  GameState.postsData.forEach(p => {
    p.fireEffect.update(deltaTime);
    if (p.beacon) p.beacon.update();
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
