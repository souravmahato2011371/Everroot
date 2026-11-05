import Phaser from 'phaser';

type Node = { x: number; y: number; amount: number; shape: Phaser.GameObjects.Arc; label: string };
type Critter = { x: number; y: number; hp: number; body: Phaser.GameObjects.Ellipse; alive: boolean };
type Inventory = { berries: number; wood: number; stones: number };

const WORLD = { width: 1800, height: 1400 };
const SAVE_KEY = 'everroot-save-v1';

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private nodes: Node[] = [];
  private critters: Critter[] = [];
  private moveTarget: Phaser.Math.Vector2 | null = null;
  private joystickPointer: number | null = null;
  private joystickOrigin = new Phaser.Math.Vector2();
  private joystickVector = new Phaser.Math.Vector2();
  private inventory: Inventory = { berries: 0, wood: 0, stones: 0 };
  private health = 5;
  private message!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private messageUntil = 0;
  private facing = 1;

  constructor() { super('WorldScene'); }

  create(): void {
    this.drawWorld();
    this.loadSave();
    this.createPlayer();
    this.createResources();
    this.createCritters();
    this.createHud();

    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.startFollow(this.player, true, 0.09, 0.09);
    this.cameras.main.setZoom(Math.min(1, this.scale.width / 760));
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,F,SPACE,ESC') as Record<string, Phaser.Input.Keyboard.Key>;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.x < this.scale.width * 0.48 && pointer.y > this.scale.height * 0.35) {
        this.joystickPointer = pointer.id;
        this.joystickOrigin.set(pointer.x, pointer.y);
        this.joystickVector.set(0, 0);
      } else {
        const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.moveTarget = new Phaser.Math.Vector2(point.x, point.y);
      }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickPointer || !pointer.isDown) return;
      this.joystickVector.set(pointer.x - this.joystickOrigin.x, pointer.y - this.joystickOrigin.y).limit(48).scale(1 / 48);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.joystickPointer) {
        this.joystickPointer = null;
        this.joystickVector.set(0, 0);
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.save());
    this.showMessage('The forest remembers every footstep.');
  }

  private drawWorld(): void {
    const g = this.add.graphics();
    g.fillStyle(0x294b36, 1).fillRect(0, 0, WORLD.width, WORLD.height);
    g.fillStyle(0x31563c, 1);
    for (let y = 35; y < WORLD.height; y += 90) {
      for (let x = 35; x < WORLD.width; x += 90) {
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const r = n - Math.floor(n);
        g.fillCircle(x + r * 34, y + (1 - r) * 30, 2 + r * 3);
      }
    }
    // Winding pale trail
    g.lineStyle(42, 0x9b936c, 0.9);
    g.beginPath(); g.moveTo(0, 920); g.lineTo(360, 900); g.lineTo(600, 760); g.lineTo(900, 820); g.lineTo(1180, 650); g.lineTo(1500, 700); g.lineTo(1800, 540); g.strokePath();
    g.lineStyle(3, 0xc4b98c, 0.25);
    g.beginPath(); g.moveTo(0, 920); g.lineTo(360, 900); g.lineTo(600, 760); g.lineTo(900, 820); g.lineTo(1180, 650); g.lineTo(1500, 700); g.lineTo(1800, 540); g.strokePath();
    // Settlement clearing
    g.fillStyle(0x6d7650, 0.85).fillEllipse(400, 880, 340, 220);
    g.fillStyle(0x8c7650, 1).fillRoundedRect(315, 820, 170, 110, 12);
    g.fillStyle(0xb89a65, 1).fillTriangle(300, 825, 400, 750, 500, 825);
    g.fillStyle(0x3d2e26, 1).fillRect(385, 870, 34, 60);
    // Forest trees
    for (let i = 0; i < 115; i++) {
      const x = 70 + ((i * 197) % 1660);
      const y = 55 + ((i * 283) % 1270);
      if (Math.abs(x - 400) < 210 && Math.abs(y - 880) < 145) continue;
      this.drawTree(x, y, 0.75 + (i % 5) * 0.09);
    }
    // pond
    g.fillStyle(0x244f58, 1).fillEllipse(1390, 330, 280, 180);
    g.lineStyle(5, 0x78a69a, 0.6).strokeEllipse(1390, 330, 280, 180);
    g.destroy();
  }

  private drawTree(x: number, y: number, scale: number): void {
    const tree = this.add.container(x, y);
    const shadow = this.add.ellipse(0, 10, 58 * scale, 22 * scale, 0x17291d, 0.35);
    const trunk = this.add.rectangle(0, -12 * scale, 13 * scale, 40 * scale, 0x65472f);
    const leavesBack = this.add.circle(-9 * scale, -43 * scale, 27 * scale, 0x1b3e2d);
    const leaves = this.add.circle(7 * scale, -53 * scale, 29 * scale, 0x356b43);
    const glint = this.add.circle(-2 * scale, -64 * scale, 9 * scale, 0x568b50, 0.8);
    tree.add([shadow, trunk, leavesBack, leaves, glint]);
    tree.setDepth(y + 100);
  }

  private createPlayer(): void {
    this.playerShadow = this.add.ellipse(0, 13, 30, 12, 0x102017, 0.4);
    const body = this.add.ellipse(0, 0, 22, 28, 0xe8c18b);
    const coat = this.add.rectangle(0, 6, 20, 17, 0xc96d4d);
    const head = this.add.circle(0, -13, 10, 0xf0c99a);
    const hair = this.add.arc(0, -17, 10, 190, 350, false, 0x4b3025).setFillStyle(0x4b3025);
    const scarf = this.add.rectangle(7, -1, 9, 5, 0xe6a84f);
    this.player = this.add.container(400, 790, [this.playerShadow, body, coat, head, hair, scarf]);
    this.player.setDepth(790);
    this.player.setSize(22, 30);
  }

  private createResources(): void {
    const spots = [
      [250, 650, 'berries', 3], [720, 520, 'wood', 3], [1020, 980, 'stones', 3],
      [1280, 850, 'berries', 3], [1550, 1050, 'wood', 3], [900, 300, 'stones', 3],
      [600, 1120, 'berries', 3], [1120, 500, 'wood', 3]
    ] as const;
    for (const [x, y, type, amount] of spots) {
      const color = type === 'berries' ? 0xd66a78 : type === 'wood' ? 0xb88a55 : 0x9eaaa3;
      const shape = this.add.circle(x, y, 12, color).setStrokeStyle(3, 0xe6d9ae, 0.8).setDepth(y + 1);
      this.add.circle(x - 4, y - 4, 3, 0xffffff, 0.6).setDepth(y + 2);
      this.nodes.push({ x, y, amount, shape, label: type });
    }
  }

  private createCritters(): void {
    for (const [x, y] of [[780, 680], [1080, 1120], [1480, 480]] as number[][]) {
      const body = this.add.ellipse(x, y, 30, 22, 0x9c6650).setStrokeStyle(2, 0x593d32).setDepth(y + 2);
      this.add.circle(x - 8, y - 5, 3, 0xf4d9a8).setDepth(y + 3);
      this.critters.push({ x, y, hp: 2, body, alive: true });
    }
  }

  private createHud(): void {
    this.stats = this.add.text(18, 16, '', { fontFamily: 'Arial', fontSize: '16px', color: '#f5edcf', backgroundColor: '#17251edc', padding: { x: 12, y: 9 } }).setScrollFactor(0).setDepth(10000);
    this.message = this.add.text(18, 66, '', { fontFamily: 'Arial', fontSize: '14px', color: '#f8e9c2', backgroundColor: '#17251edc', padding: { x: 12, y: 8 } }).setScrollFactor(0).setDepth(10000);
    this.hint = this.add.text(18, 0, 'Move: WASD / arrows / left touch  •  Tap ground to walk  •  E: gather  •  F: defend  •  Save: auto', { fontFamily: 'Arial', fontSize: '12px', color: '#d6dfc7', backgroundColor: '#17251ecc', padding: { x: 10, y: 7 } }).setScrollFactor(0).setDepth(10000);
    this.layoutHud();
    this.scale.on('resize', this.layoutHud, this);
    this.refreshStats();
  }

  private layoutHud(): void {
    this.hint.setPosition(18, this.scale.height - 38).setWordWrapWidth(Math.max(260, this.scale.width - 36));
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.04);
    let dx = Number(this.cursors.right.isDown || this.keys.D.isDown) - Number(this.cursors.left.isDown || this.keys.A.isDown);
    let dy = Number(this.cursors.down.isDown || this.keys.S.isDown) - Number(this.cursors.up.isDown || this.keys.W.isDown);
    if (this.joystickPointer !== null) { dx = this.joystickVector.x; dy = this.joystickVector.y; }
    const length = Math.hypot(dx, dy);
    if (length > 0.08) {
      this.moveTarget = null;
      this.movePlayer(dx / Math.max(1, length), dy / Math.max(1, length), dt);
    } else if (this.moveTarget) {
      const vx = this.moveTarget.x - this.player.x;
      const vy = this.moveTarget.y - this.player.y;
      const distance = Math.hypot(vx, vy);
      if (distance < 8) this.moveTarget = null;
      else this.movePlayer(vx / distance, vy / distance, dt);
    }
    this.player.setDepth(this.player.y + 100);
    this.playerShadow.setDepth(this.player.y + 99);
    if (Phaser.Input.Keyboard.JustDown(this.keys.E) || Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.interact();
    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) this.attack();
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) this.save();
    this.updateCritters(dt);
    if (this.time.now > this.messageUntil) this.message.setText('');
  }

  private movePlayer(dx: number, dy: number, dt: number): void {
    const speed = 190;
    const nx = Phaser.Math.Clamp(this.player.x + dx * speed * dt, 18, WORLD.width - 18);
    const ny = Phaser.Math.Clamp(this.player.y + dy * speed * dt, 18, WORLD.height - 18);
    this.player.setPosition(nx, ny);
    if (dx !== 0) { this.facing = Math.sign(dx); this.player.setScale(this.facing, 1); }
  }

  private interact(): void {
    const nearby = this.nodes.find(n => n.amount > 0 && Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y) < 54);
    if (nearby) {
      nearby.amount--;
      this.inventory[nearby.label as keyof typeof this.inventory]++;
      if (nearby.amount === 0) nearby.shape.setVisible(false);
      this.showMessage(`Gathered ${nearby.label}. The forest gives, and grows again.`);
      this.refreshStats();
      this.save();
      return;
    }
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, 400, 880) < 100) {
      this.showMessage('A quiet home base. Your journey is just beginning.');
    } else {
      this.showMessage('Nothing close enough to gather. Explore the forest.');
    }
  }

  private attack(): void {
    const target = this.critters.find(c => c.alive && Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y) < 76);
    if (!target) { this.showMessage('No forest critter nearby.'); return; }
    target.hp--;
    target.body.setFillStyle(0xd68a67);
    if (target.hp <= 0) {
      target.alive = false;
      target.body.setVisible(false);
      this.inventory.berries++;
      this.showMessage('The little guardian scampers away. Found 1 wild berry.');
      this.refreshStats();
      this.save();
    } else this.showMessage('A gentle warning sends it hopping back.');
  }

  private updateCritters(dt: number): void {
    for (const c of this.critters) {
      if (!c.alive) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y);
      if (d < 210 && d > 42) {
        const a = Math.atan2(this.player.y - c.y, this.player.x - c.x);
        c.x += Math.cos(a) * 28 * dt;
        c.y += Math.sin(a) * 28 * dt;
        c.body.setPosition(c.x, c.y).setDepth(c.y + 2);
      }
      if (d < 30) {
        this.health = Math.max(0, this.health - dt * 0.5);
        if (this.health <= 0) {
          this.health = 5;
          this.player.setPosition(400, 790);
          this.showMessage('You catch your breath back at the settlement.');
        }
        this.refreshStats();
      }
    }
  }

  private refreshStats(): void {
    this.stats.setText(`♥ ${Math.ceil(this.health)}/5     ✿ ${this.inventory.berries}     Wood ${this.inventory.wood}     Stone ${this.inventory.stones}`);
  }

  private showMessage(text: string): void {
    this.message.setText(text);
    this.messageUntil = this.time.now + 2600;
  }

  private save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ inventory: this.inventory, health: this.health, player: { x: this.player.x, y: this.player.y } }));
      this.showMessage('Progress saved on this device.');
    } catch { this.showMessage('Save unavailable in this browser session.'); }
  }

  private loadSave(): void {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { inventory?: Partial<Inventory>; health?: number; player?: { x: number; y: number } };
      if (data.inventory) this.inventory = { ...this.inventory, ...data.inventory };
      if (data.health !== undefined) this.health = Phaser.Math.Clamp(data.health, 1, 5);
      if (data.player && Number.isFinite(data.player.x) && Number.isFinite(data.player.y)) this.moveTarget = new Phaser.Math.Vector2(data.player.x, data.player.y);
    } catch { /* Ignore an invalid or old save safely. */ }
  }
}