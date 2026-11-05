import Phaser from 'phaser';
import { WorldScene } from '../scenes/WorldScene';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#17251e',
  width: 960,
  height: 600,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    min: { width: 320, height: 240 }
  },
  input: { activePointers: 3 },
  render: { antialias: false, pixelArt: true, roundPixels: true },
  scene: [WorldScene]
};