# AGENTS.md - Architecture Guide

## Overview
This project has been refactored from a single `index.html` file into a modular JavaScript architecture using ES Modules. This structure ensures better maintainability and separation of concerns.

## Directory Structure
```
/js
  /effects        # Visual effects classes
    CyberFireflies.js
    FireEffect.js
    LightBeacon.js
    TrailRibbon.js
  /entities       # Game entities
    DroneBall.js
  /Config.js      # Global configuration object (CONFIG)
  /Globals.js     # Shared Global State (Scene, Camera, Game Objects)
  /Main.js        # Entry point, Event Listeners, and Animation Loop
  /Spline.js      # Curve and pathfinding logic
  /Theme.js       # Day/Night cycle and visual themes
  /Utils.js       # Helper functions
  /World.js       # World generation and Round logic
```

## Key Components

### 1. Global State (`js/Globals.js`)
Instead of global variables attached to `window`, all shared state is held in the `GameState` object exported from `Globals.js`.
- Access this to modify `scene`, `camera`, `postsData`, `ballsArray`, etc.
- Example: `import { GameState } from './Globals.js'; GameState.scene.add(...)`

### 2. Configuration (`js/Config.js`)
All tunable parameters (speed, counts, sizes) are in the `CONFIG` object.
- UI Controls in `index.html` modify `CONFIG` via listeners in `Main.js`.

### 3. Entry Point (`js/Main.js`)
- Initializes the Three.js scene, renderer, and lights.
- Sets up UI event listeners.
- Contains the main `animate()` loop.
- **Note**: If you need to change the game loop logic (movement, collision detection), check `animate()` here.

### 4. World Logic (`js/World.js`)
- `generateWorld()`: Rebuilds the scene (terrain, posts, enemies) based on current config.
- `startPlayerRound()`: Logic for starting a new player run.
- `resetFireflies()`: Helper to restart/update the fireflies effect without regenerating the whole world.

## How to Evolve this Project

### Adding a New Visual Effect
1. Create a new class in `js/effects/MyNewEffect.js`.
2. Import it in `js/World.js`.
3. Instantiate it inside `generateWorld()` and attach it to relevant objects.
4. If it needs per-frame updates, call its `update()` method inside `animate()` in `js/Main.js`.
5. If it needs dynamic updates from UI (like resetting), expose a specific function in `World.js`.

### Modifying Game Rules
- **Movement/Splines**: Edit `js/Spline.js` for path generation or `js/Main.js` for player movement along the spline.
- **Level Generation**: Edit `generateWorld()` in `js/World.js`.

### Changing UI
- HTML/CSS changes go in `index.html`.
- Logic changes (event listeners) go in `js/Main.js`.

## Dependencies
- **Three.js**: Imported via CDN in `index.html` (ImportMap). Modules use `import * as THREE from 'three'`.
