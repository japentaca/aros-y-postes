import * as THREE from 'three';
import { GameState, updateStatus } from './Globals.js';
import { CONFIG } from './Config.js';

export function setupSkybox(url) {
  const loader = new THREE.ImageLoader();
  loader.setCrossOrigin('anonymous');

  updateStatus("CARGANDO SKYBOX...", "#ffff00");

  loader.load(url, (image) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const tileWidth = image.width / 4;
    const tileHeight = image.height / 3;
    canvas.width = tileWidth;
    canvas.height = tileHeight;

    const getTile = (x, y) => {
      ctx.drawImage(image, x * tileWidth, y * tileHeight, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
      const c = document.createElement('canvas');
      c.width = tileWidth;
      c.height = tileHeight;
      c.getContext('2d').drawImage(canvas, 0, 0);
      return c;
    };

    const faces = [
      getTile(2, 1), // px
      getTile(0, 1), // nx
      getTile(1, 0), // py
      getTile(1, 2), // ny
      getTile(1, 1), // pz
      getTile(3, 1)  // nz
    ];

    const cubeTexture = new THREE.CubeTexture(faces);
    cubeTexture.needsUpdate = true;
    GameState.scene.background = cubeTexture;
    updateStatus("SKYBOX OK", "#00ff00");

    // Pequeño timeout para limpiar mensaje
    setTimeout(() => updateStatus("LISTO", "#00ff00"), 2000);

  }, undefined, (err) => {
    console.warn("Error cargando skybox", err);
    updateStatus("ERROR SKYBOX", "#ff0000");
  });
}

export function updateTheme(ambientLight, dirLight) {
  if (CONFIG.isNight) {
    // MODO NOCHE: Cyberpunk Neon
    setupSkybox('./nightskybox.jpg');

    // Luces: Oscuridad general, solo glow

    if (ambientLight) ambientLight.intensity = 0.1;
    if (dirLight) dirLight.intensity = 0.0; // Desactivar luz direccional principal para que resalte el neón

    // Terreno oscuro
    if (GameState.terrainMesh) {
      GameState.terrainMesh.visible = !CONFIG.isNight; // Hide solid floor in night
      if (!CONFIG.isNight) {
        GameState.terrainMesh.material.color.setHex(0x55aa55);
        GameState.terrainMesh.material.emissive.setHex(0x000000);
      }
    }

    if (GameState.gridHelper) {
      GameState.gridHelper.visible = CONFIG.isNight; // Show grid in night
    }

    // Postes (Pillars) - Hacerlos oscuros con glow suave
    GameState.postMat.color.setHex(0x111111);
    GameState.postMat.emissive.setHex(0x4400cc); // Violeta/Azul oscuro
    GameState.postMat.emissiveIntensity = 0.8;

    // Actualizar objetos dinámicos (Aros)
    GameState.postsData.forEach(p => {
      // Mantener el color base del estado del juego (rojo, amarillo, azul)
      // Pero hacerlo brillar intensamente
      const color = p.mesh.material.color;
      p.mesh.material.emissive.copy(color);
      p.mesh.material.emissiveIntensity = 2.0;
    });

    // Actualizar Balones Rivales
    GameState.ballsArray.forEach(b => {
      const color = b.mesh.material.color;
      b.mesh.material.emissive.copy(color);
      b.mesh.material.emissiveIntensity = 2.0;
    });

  } else {
    // MODO DÍA: Normal
    setupSkybox('./skybox.jpeg');

    if (ambientLight) ambientLight.intensity = 0.6;
    if (dirLight) dirLight.intensity = 0.8;

    if (GameState.terrainMesh) {
      GameState.terrainMesh.visible = !CONFIG.isNight;
      if (!CONFIG.isNight) {
        GameState.terrainMesh.material.color.setHex(0x55aa55);
        GameState.terrainMesh.material.emissive.setHex(0x000000);
      }
    }

    if (GameState.gridHelper) {
      GameState.gridHelper.visible = CONFIG.isNight;
    }

    // Postes (Pillars)
    GameState.postMat.color.setHex(0x888888);
    GameState.postMat.emissive.setHex(0x000000);

    // Aros
    GameState.postsData.forEach(p => {
      p.mesh.material.emissiveIntensity = 1.0;
      p.mesh.material.emissive.setHex(0x000000);
    });

    GameState.ballsArray.forEach(b => {
      b.mesh.material.emissive.setHex(0x000000);
    });
  }

  if (GameState.fireflies) GameState.fireflies.setNightMode(CONFIG.isNight);
}
