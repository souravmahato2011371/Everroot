import Phaser from 'phaser';
import { gameConfig } from './game/config';

const game = new Phaser.Game({ ...gameConfig, parent: 'game' });

window.addEventListener('resize', () => game.scale.refresh());