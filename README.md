# Everroot

**Every root holds a story.**

Everroot is an original single-player, third-person 3D adventure for the browser. The visual direction is a natural, richly detailed fantasy world: smooth forms, detailed surface materials, fine terrain and bark texture, atmospheric lighting, soft shadows, and expressive wildlife. The project is moving away from low-poly styling.

## Current playable foundation

- Three.js real-time 3D rendering with physically based materials and tone mapping.
- Procedural terrain and generated surface maps for ground, bark and stone.
- Smooth tree canopies, instanced foliage and detailed forest props.
- A woodland settlement, winding trail, pond and distant landscape.
- A third-person traveller with basic idle and walk motion.
- Rapier 3D physics with a terrain triangle mesh, character capsule, tree and building collision, ground snapping, slope limits and autostep.
- Dynamic rolling stones with rigid-body physics.
- Accelerated movement, camera-relative controls, sprint, jump and tap-to-walk.
- Touch joystick, swipe camera orbit, pinch zoom, interaction and local save data.

This is an upgraded foundation slice, not a finished hyper-realistic game. The current environment and textures are generated procedurally. High-end photorealism still needs authored character and environment assets, complete PBR texture sets, advanced animation, sound, and performance testing on actual Android devices.

## Technology

- Three.js 0.187
- Rapier 3D compatibility package
- TypeScript and Vite
- GitHub Actions for type-checking and production builds
- GitHub Pages for hosting

## Controls

**Touch**
- Drag the lower-left joystick to move.
- Hold **HOLD TO RUN** to sprint.
- Tap **JUMP** while grounded.
- Tap the ground to walk to a location.
- Drag on the right side to rotate the camera.
- Pinch with two fingers to zoom.
- Use **INTERACT** near resources or forest friends.
- Use **SAVE JOURNEY** to save.

**Keyboard**
- WASD or arrow keys: move relative to the camera.
- Shift: sprint.
- Space: jump.
- E: interact.
- Escape: save.
- Drag with the mouse on the right side: rotate the camera.
- Mouse wheel: zoom.

## Development workflow

The project is designed for an Android-tablet workflow using ChatGPT and GitHub. ChatGPT prepares and updates project files; GitHub Actions type-checks and builds the game in the cloud; GitHub Pages hosts the result. All project work is committed directly to the `main` branch. No local PC, coding app or terminal is required for the normal workflow.

## Design pillars

1. **True 3D exploration:** a perspective world and third-person camera.
2. **Natural detailed visuals:** smooth forms, material detail, atmospheric lighting and shadows.
3. **Physical movement:** collision-aware character control, slopes, jumping and interactive rigid bodies.
4. **Touch-first play:** movement, camera orbit and zoom designed for Android tablets.
5. **A living forest:** wildlife, resources, gathering, crafting and a settlement that can grow over time.

## Deployment

GitHub Actions builds and deploys the `dist` folder to GitHub Pages whenever changes are pushed to `main`. Enable GitHub Pages with **GitHub Actions** as the deployment source in repository Settings if it is not already enabled.
