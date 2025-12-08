import * as THREE from 'three';

export const GameState = {
  postsData: [],
  ballsArray: [],
  postsGroup: new THREE.Group(),
  terrainMesh: null,
  gridHelper: null,
  splineHelper: null,
  splinePoints: [],
  playerCurve: null,
  playerProgress: 0,
  playerPathIndices: [],
  playerCurrentTargetIdx: 0,
  playerNextStartId: 0,

  // UI Helpers
  statusEl: null,

  // Scene vars
  scene: null,
  camera: null,
  renderer: null,

  // Materials that were global
  postMat: new THREE.MeshStandardMaterial({ color: 0x888888 }),

  // Refs
  fireflies: null
};

export function updateStatus(msg, color = '#ffff00') {
  if (GameState.statusEl) {
    GameState.statusEl.innerText = msg;
    GameState.statusEl.style.color = color;
    GameState.statusEl.style.borderColor = color;
  }
}
