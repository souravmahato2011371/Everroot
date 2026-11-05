# Everroot

**A little world waiting to be explored.**

Everroot is an original, single-player, 2.5D-inspired pixel-art adventure game being built mobile-first for the browser. The project is designed around an Android-tablet-only workflow using ChatGPT and GitHub.

## Current build

The first playable foundation includes:
- A scrollable woodland clearing and a small settlement
- A controllable traveller (keyboard, tap-to-move, and touch joystick)
- Gatherable forest resources and a small inventory
- Simple wandering forest critters and a basic defensive action
- Local browser save data

This is an early prototype, not the finished game. Art, animation, combat depth, quests, crafting, building, audio, and the wider world will be developed in stages.

## Technology

- Phaser 3
- TypeScript
- Vite
- Browser local storage for the prototype save
- GitHub Actions and GitHub Pages for deployment

## Run locally in Acode

1. Open this repository in Acode.
2. Open its terminal and run `npm install`.
3. Run `npm run dev -- --host 0.0.0.0`.
4. Open the local preview address shown by Vite in your tablet browser.

No PC or Termux is required. The terminal built into Acode is sufficient for the local npm workflow.

## Build

```sh
npm install
npm run typecheck
npm run build
```

## Controls

- Keyboard: WASD or arrow keys
- Touch: drag on the lower-left area to move
- Tap the right side of the world to walk to a location
- E / Space: gather or interact
- F: defensive action
- Esc: save

## Project principles

1. Mobile-first and playable on touch screens.
2. Single-player and offline-friendly.
3. No backend required for the core game.
4. Keep the first playable slice small, then expand through tested milestones.
5. Keep all project work on the `main` branch.

## Deployment

The GitHub Actions workflow builds the game and deploys the `dist` folder to GitHub Pages whenever changes are pushed to `main`. Enable GitHub Pages with **GitHub Actions** as the build and deployment source in repository Settings if it is not already enabled.
