# Everroot

**Every root holds a story.**

Everroot is an original, single-player, third-person 3D fantasy exploration game for the browser. Its visual identity is a hand-drawn sketchbook: low-poly 3D forms, dark ink contours, pencil-like marks, textured surfaces, warm illustrated colours, and soft storybook lighting.

## Current playable foundation

The first 3D vertical slice includes:
- A real Three.js 3D world with a perspective camera and a follow-camera.
- A stylized traveller with simple idle and walking animation.
- A forest clearing, a small hand-built settlement, a winding trail, a pond, stones, logs, flowers, and illustrated trees.
- Friendly forest critters that wander around the clearing.
- Collectable berries, wood, and stone.
- Keyboard movement, a mobile touch joystick, tap-to-walk, and an interaction button.
- Local browser saving for the traveller's position and inventory.
- A sketchbook-inspired interface and visible startup error handling.

This is a foundation slice, not the finished game. The next milestones are improved 3D character models and animation, deeper exploration, quests, crafting, settlement building, puzzles, sound, and additional regions.

## Technology

- Three.js for real-time 3D rendering
- TypeScript and Vite
- GitHub Actions for type-checking and production builds
- GitHub Pages for hosting

## Controls

- Keyboard: WASD or arrow keys
- Touch: drag the lower-left joystick to move
- Tap the ground to walk to that location
- E or Space: interact with nearby resources and friends
- Interact button: use touch interaction
- Save Journey or Escape: save progress

## Development workflow

The project is designed for an Android-tablet workflow using ChatGPT and GitHub:
- ChatGPT prepares and updates project files in the connected repository.
- GitHub Actions installs dependencies, type-checks the TypeScript, and builds the game in the cloud.
- GitHub Pages hosts the game.
- All project work is committed directly to the `main` branch.

No local coding app, PC, or terminal is required for the normal workflow.

## Design pillars

1. **True 3D exploration:** the world is built from 3D geometry and viewed through a perspective camera.
2. **Sketchbook fantasy:** visible contours, imperfect linework, textured surfaces, and illustrated colour.
3. **Touch-first play:** controls are usable on an Android tablet as well as a keyboard.
4. **A living forest:** wildlife, resources, gathering, and a settlement that can grow over time.
5. **A complete single-player journey:** no online account or backend is required for the core game.

## Deployment

GitHub Actions builds and deploys the `dist` folder to GitHub Pages whenever changes are pushed to `main`. Enable GitHub Pages with **GitHub Actions** as the deployment source in repository Settings if it is not already enabled.
