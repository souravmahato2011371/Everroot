import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

type ResourceKind = 'berries' | 'wood' | 'stone';
type ResourceNode = { kind: ResourceKind; group: THREE.Group; position: THREE.Vector3; active: boolean };
type Critter = { group: THREE.Group; home: THREE.Vector3; phase: number };
type SaveData = {
  player: { x: number; z: number };
  inventory: Record<ResourceKind, number>;
};

const SAVE_KEY = 'everroot-save-v2';
const WORLD_SIZE = 100;
const LIMIT = 45;
const inventory: Record<ResourceKind, number> = { berries: 0, wood: 0, stone: 0 };

const scene = new THREE.Scene();
scene.background = new THREE.Color('#d5dfc8');
scene.fog = new THREE.Fog('#d5dfc8', 38, 104);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 150);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'low-power'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.id = 'world-canvas';
document.querySelector('#game')?.appendChild(renderer.domElement);

const player = new THREE.Group();
const playerVisual = new THREE.Group();
const resources: ResourceNode[] = [];
const critters: Critter[] = [];
const treeObstacles: Array<{ x: number; z: number; radius: number; height: number }> = [];
const boxObstacles: Array<{ x: number; y: number; z: number; hx: number; hy: number; hz: number }> = [];
const rockObstacles: Array<{ x: number; z: number; radius: number }> = [];
const dynamicProps: Array<{ body: any; mesh: THREE.Mesh }> = [];
let terrainGeometry: THREE.BufferGeometry | null = null;
let terrainMesh: THREE.Mesh | null = null;
let physicsWorld: any = null;
let characterController: any = null;
let playerBody: any = null;
let playerCollider: any = null;
let physicsAccumulator = 0;
let verticalVelocity = 0;
let isGrounded = false;
let jumpRequested = false;
let isRunning = false;
const PLAYER_CAPSULE_CENTER = 1.08;
const PHYSICS_STEP = 1 / 60;
const playerVelocity = new THREE.Vector3();
const windTrees: Array<{ group: THREE.Group; phase: number; strength: number }> = [];
const waterRipples: THREE.Mesh[] = [];
const floatingSeeds: THREE.Mesh[] = [];
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const walkTarget: THREE.Vector3 | null = null;
let targetPosition: THREE.Vector3 | null = walkTarget;
let moveX = 0;
let moveZ = 0;
let joystickPointer: number | null = null;
let joystickX = 0;
let joystickY = 0;
let playerMoving = false;
let elapsed = 0;
let cameraYaw = 0;
let cameraPitch = 0.48;
let cameraDistance = 15.5;
let cameraPointerId: number | null = null;
let cameraLastX = 0;
let cameraLastY = 0;
let cameraDragDistance = 0;
let cameraPointerStartedAt = 0;
let pinchStartDistance = 0;
let pinchStartZoom = cameraDistance;
const activePointers = new Map<number, { x: number; y: number }>();

const ui = {
  loading: document.querySelector<HTMLElement>('#loading')!,
  error: document.querySelector<HTMLElement>('#error')!,
  message: document.querySelector<HTMLElement>('#message')!,
  stats: document.querySelector<HTMLElement>('#stats')!,
  joystick: document.querySelector<HTMLElement>('#joystick')!,
  knob: document.querySelector<HTMLElement>('#joystick-knob')!,
  interact: document.querySelector<HTMLButtonElement>('#interact')!,
  save: document.querySelector<HTMLButtonElement>('#save'),
  run: document.querySelector<HTMLButtonElement>('#run'),
  jump: document.querySelector<HTMLButtonElement>('#jump')
};

function terrainHeight(x: number, z: number): number {
  return Math.sin(x * 0.12) * 0.16 + Math.cos(z * 0.13) * 0.13 + Math.sin((x + z) * 0.08) * 0.09;
}

function seeded(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function makeSketchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas textures are not available in this browser.');
  context.fillStyle = '#a4b68a';
  context.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1250; i++) {
    const x = seeded(i + 8) * 256;
    const y = seeded(i + 900) * 256;
    context.strokeStyle = i % 4 === 0 ? 'rgba(45,67,45,.12)' : 'rgba(238,230,190,.16)';
    context.lineWidth = 0.5 + seeded(i + 1700);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 1 + seeded(i + 2600) * 5, y - 1 - seeded(i + 3600) * 3);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 7);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
  return texture;
}

const sketchInk = new THREE.LineBasicMaterial({
  color: '#40362d',
  transparent: true,
  opacity: 0.76,
  depthWrite: false
});

function addOutlinedMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  threshold = 24,
  opacity = 0.76
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  const edges = new THREE.EdgesGeometry(geometry, threshold);
  const ink = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: '#40362d',
      transparent: true,
      opacity,
      depthWrite: false
    })
  );
  ink.renderOrder = 2;
  mesh.add(ink);
  return mesh;
}

function addGround(): void {
  const segments = 64;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let iz = 0; iz <= segments; iz++) {
    const z = -WORLD_SIZE / 2 + (iz / segments) * WORLD_SIZE;
    for (let ix = 0; ix <= segments; ix++) {
      const x = -WORLD_SIZE / 2 + (ix / segments) * WORLD_SIZE;
      positions.push(x, terrainHeight(x, z), z);
      uvs.push(ix / segments * 7, iz / segments * 7);
    }
  }
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * (segments + 1) + ix;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: '#e0e0bc',
      map: makeSketchTexture(),
      roughness: 1
    })
  );
  ground.receiveShadow = true;
  scene.add(ground);
}

function addPath(): void {
  const controlPoints = [
    new THREE.Vector3(-48, 0, 23),
    new THREE.Vector3(-31, 0, 19),
    new THREE.Vector3(-18, 0, 10),
    new THREE.Vector3(-4, 0, 12),
    new THREE.Vector3(9, 0, 3),
    new THREE.Vector3(23, 0, 8),
    new THREE.Vector3(37, 0, -8),
    new THREE.Vector3(49, 0, -15)
  ];
  const curve = new THREE.CatmullRomCurve3(controlPoints);
  const samples = curve.getPoints(110);
  const vertices: number[] = [];
  const indices: number[] = [];
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  samples.forEach((point, index) => {
    const tangent = curve.getTangent(index / (samples.length - 1)).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(1.65);
    const l = point.clone().add(side);
    const r = point.clone().sub(side);
    l.y = terrainHeight(l.x, l.z) + 0.045;
    r.y = terrainHeight(r.x, r.z) + 0.045;
    left.push(l);
    right.push(r);
    vertices.push(l.x, l.y, l.z, r.x, r.y, r.z);
    if (index < samples.length - 1) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const path = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: '#c7b58a', roughness: 1, side: THREE.DoubleSide })
  );
  path.receiveShadow = true;
  scene.add(path);

  const edgeMaterial = new THREE.LineBasicMaterial({ color: '#655947', transparent: true, opacity: 0.58 });
  for (const edge of [left, right]) {
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(edge);
    const line = new THREE.Line(lineGeometry, edgeMaterial);
    line.position.y += 0.025;
    scene.add(line);
  }
}

function addSketchHatching(parent: THREE.Object3D, x: number, y: number, z: number, size: number): void {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const offset = (i - 2) * size * 0.16;
    points.push(new THREE.Vector3(x - size * 0.35 + offset, y + size * 0.15, z + size * 0.68));
    points.push(new THREE.Vector3(x + size * 0.16 + offset, y - size * 0.18, z + size * 0.68));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const marks = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: '#3d4933',
    transparent: true,
    opacity: 0.24
  }));
  parent.add(marks);
}

function addDistantLandscape(): void {
  const layers = [
    { z: -52, y: -1.2, color: '#a8b99b', points: [[-70, -4], [-58, 1], [-48, 5], [-37, 1], [-24, 7], [-9, 2], [5, 8], [20, 2], [36, 6], [51, 1], [70, 5]] },
    { z: -47, y: -1.8, color: '#8da582', points: [[-70, -4], [-56, 3], [-42, 0], [-27, 5], [-13, 1], [1, 6], [18, 0], [34, 4], [49, 0], [70, 4]] },
    { z: -42, y: -2.4, color: '#718b68', points: [[-70, -4], [-55, 0], [-43, 4], [-30, 0], [-14, 3], [1, -1], [18, 4], [34, 0], [50, 3], [70, -2]] }
  ];
  for (const layer of layers) {
    const shape = new THREE.Shape();
    shape.moveTo(-70, -6);
    shape.lineTo(layer.points[0][0], layer.points[0][1]);
    for (let i = 1; i < layer.points.length; i++) {
      const previous = layer.points[i - 1];
      const point = layer.points[i];
      const midX = (previous[0] + point[0]) / 2;
      const midY = (previous[1] + point[1]) / 2;
      shape.quadraticCurveTo(previous[0], previous[1], midX, midY);
    }
    const last = layer.points[layer.points.length - 1];
    shape.quadraticCurveTo(last[0], last[1], 70, last[1]);
    shape.lineTo(70, -6);
    shape.closePath();
    const ridge = new THREE.Mesh(
      new THREE.ShapeGeometry(shape, 16),
      new THREE.MeshBasicMaterial({ color: layer.color, side: THREE.DoubleSide, fog: true })
    );
    ridge.position.set(0, layer.y, layer.z);
    scene.add(ridge);

    const contour = shape.getPoints(80).map((point) => new THREE.Vector3(point.x, point.y + layer.y, layer.z + 0.04));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(contour),
      new THREE.LineBasicMaterial({ color: '#52634d', transparent: true, opacity: 0.42 })
    );
    scene.add(line);
  }

  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = 128;
  sunCanvas.height = 128;
  const context = sunCanvas.getContext('2d');
  if (context) {
    const glow = context.createRadialGradient(64, 64, 3, 64, 64, 62);
    glow.addColorStop(0, 'rgba(255,246,205,.85)');
    glow.addColorStop(0.26, 'rgba(255,231,176,.32)');
    glow.addColorStop(1, 'rgba(255,231,176,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(sunCanvas);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, color: '#fff2cf', transparent: true, depthWrite: false, fog: true
    }));
    sunGlow.position.set(-23, 17, -39);
    sunGlow.scale.set(17, 17, 1);
    scene.add(sunGlow);
  }

  for (let i = 0; i < 4; i++) {
    const cloud = new THREE.Group();
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: i % 2 ? '#edf0d9' : '#f4efd9',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      fog: true
    });
    for (let puff = 0; puff < 4; puff++) {
      const shape = new THREE.Mesh(new THREE.SphereGeometry(1.15 + (puff % 2) * 0.25, 9, 7), cloudMaterial);
      shape.scale.y = 0.34;
      shape.position.set((puff - 1.5) * 1.25, (puff % 2) * 0.25, 0);
      cloud.add(shape);
    }
    cloud.position.set(-32 + i * 23, 16 + (i % 2) * 3, -47 - (i % 2) * 4);
    scene.add(cloud);
  }
}

function addGrass(): void {
  const blades: number[] = [];
  const highlights: number[] = [];
  for (let i = 0; i < 720; i++) {
    const x = seeded(i + 3310) * 88 - 44;
    const z = seeded(i + 7710) * 88 - 44;
    const onClearing = Math.abs(x + 7) < 8.5 && Math.abs(z - 1) < 7;
    const onPond = ((x - 24) / 8.6) ** 2 + ((z + 22) / 6.4) ** 2 < 1;
    const onPath = Math.abs(x + z * 0.5 - 1) < 2.25;
    if (onClearing || onPond || onPath) continue;
    const groundY = terrainHeight(x, z) + 0.035;
    for (let blade = 0; blade < 3; blade++) {
      const bx = x + (seeded(i * 5 + blade + 1) - 0.5) * 0.46;
      const bz = z + (seeded(i * 7 + blade + 4) - 0.5) * 0.46;
      const height = 0.18 + seeded(i * 11 + blade + 8) * 0.24;
      const lean = (seeded(i * 13 + blade + 2) - 0.5) * 0.2;
      blades.push(bx, groundY, bz, bx + lean, groundY + height, bz - 0.035);
      if (blade === 1) {
        highlights.push(bx + lean * 0.3, groundY + height * 0.48, bz, bx + lean, groundY + height, bz - 0.035);
      }
    }
  }
  const baseGeometry = new THREE.BufferGeometry();
  baseGeometry.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
  scene.add(new THREE.LineSegments(baseGeometry, new THREE.LineBasicMaterial({
    color: '#526c43', transparent: true, opacity: 0.5
  })));
  const highlightGeometry = new THREE.BufferGeometry();
  highlightGeometry.setAttribute('position', new THREE.Float32BufferAttribute(highlights, 3));
  scene.add(new THREE.LineSegments(highlightGeometry, new THREE.LineBasicMaterial({
    color: '#d0cb91', transparent: true, opacity: 0.62
  })));
}

function addBranch(parent: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material): void {
  const direction = end.clone().sub(start);
  const branch = addOutlinedMesh(parent, new THREE.CylinderGeometry(radius * 0.58, radius, direction.length(), 6), material, 28, 0.48);
  branch.position.copy(start).add(end).multiplyScalar(0.5);
  branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

function addTree(x: number, z: number, scale: number): void {
  const tree = new THREE.Group();
  tree.position.set(x, terrainHeight(x, z), z);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#806044', roughness: 1, flatShading: true });
  const bark = new THREE.MeshStandardMaterial({ color: '#a17c58', roughness: 1, flatShading: true });
  const palettes = [
    ['#496f49', '#668653', '#8ba16a'],
    ['#4b7252', '#73915b', '#9eaa72'],
    ['#54734a', '#7e9455', '#b1aa75'],
    ['#3f6954', '#63856c', '#91a58a']
  ];
  const palette = palettes[Math.floor(seeded(x * 17 + z * 3) * palettes.length)];
  const leafMaterials = palette.map((color) => new THREE.MeshStandardMaterial({
    color, flatShading: true, roughness: 1
  }));
  addOutlinedMesh(tree, new THREE.CylinderGeometry(0.25 * scale, 0.43 * scale, 2.2 * scale, 7), trunkMaterial, 24, 0.58);
  addBranch(tree, new THREE.Vector3(0, 0.95 * scale, 0), new THREE.Vector3(-0.72 * scale, 2.15 * scale, 0.05 * scale), 0.19 * scale, bark);
  addBranch(tree, new THREE.Vector3(0.05 * scale, 1.12 * scale, 0), new THREE.Vector3(0.7 * scale, 2.35 * scale, -0.1 * scale), 0.17 * scale, bark);
  addBranch(tree, new THREE.Vector3(0, 1.35 * scale, -0.02 * scale), new THREE.Vector3(0.08 * scale, 2.9 * scale, 0.15 * scale), 0.14 * scale, bark);
  const crown1 = addOutlinedMesh(tree, new THREE.IcosahedronGeometry(1.48 * scale, 1), leafMaterials[0], 27, 0.54);
  crown1.position.set(-0.58 * scale, 2.65 * scale, 0);
  crown1.scale.set(1.06, 0.91, 0.96);
  const crown2 = addOutlinedMesh(tree, new THREE.IcosahedronGeometry(1.38 * scale, 1), leafMaterials[1], 27, 0.54);
  crown2.position.set(0.57 * scale, 3.1 * scale, -0.12 * scale);
  crown2.scale.set(1.08, 1, 0.92);
  const crown3 = addOutlinedMesh(tree, new THREE.IcosahedronGeometry(1.02 * scale, 1), leafMaterials[2], 27, 0.52);
  crown3.position.set(0.02 * scale, 3.92 * scale, 0.08 * scale);
  const crown4 = addOutlinedMesh(tree, new THREE.IcosahedronGeometry(0.82 * scale, 1), leafMaterials[1], 27, 0.5);
  crown4.position.set(-1.02 * scale, 3.02 * scale, -0.12 * scale);
  crown4.scale.set(0.95, 0.88, 0.92);
  addSketchHatching(tree, 0, 3.05 * scale, 0, scale);
  tree.userData.windPhase = seeded(x * 21 + z * 7) * Math.PI * 2;
  tree.userData.windStrength = 0.008 + seeded(x + z * 5) * 0.009;
  windTrees.push({ group: tree, phase: tree.userData.windPhase, strength: tree.userData.windStrength });
  scene.add(tree);
}

function addHut(): void {
  const hut = new THREE.Group();
  const x = -7;
  const z = 1;
  hut.position.set(x, terrainHeight(x, z), z);
  const wall = new THREE.MeshStandardMaterial({ color: '#d6bd91', roughness: 1, flatShading: true });
  const roof = new THREE.MeshStandardMaterial({ color: '#a85f4c', roughness: 1, flatShading: true });
  const darkWood = new THREE.MeshStandardMaterial({ color: '#5a4937', roughness: 1 });
  const plaster = addOutlinedMesh(hut, new THREE.BoxGeometry(5.2, 3.1, 4.4), wall);
  plaster.position.y = 1.58;
  const roofMesh = addOutlinedMesh(hut, new THREE.ConeGeometry(3.8, 2.5, 4), roof, 14);
  roofMesh.position.y = 4.35;
  roofMesh.rotation.y = Math.PI / 4;
  const door = addOutlinedMesh(hut, new THREE.BoxGeometry(1.05, 1.85, 0.12), darkWood);
  door.position.set(0.5, 0.93, 2.26);
  const windowMaterial = new THREE.MeshStandardMaterial({ color: '#8bb4ac', roughness: 0.4 });
  for (const wx of [-1.55, 2.05]) {
    const frame = addOutlinedMesh(hut, new THREE.BoxGeometry(0.9, 0.82, 0.13), darkWood);
    frame.position.set(wx, 1.8, 2.27);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.56, 0.05), windowMaterial);
    glass.position.set(wx, 1.8, 2.36);
    hut.add(glass);
  }
  scene.add(hut);

  const camp = new THREE.Group();
  camp.position.set(-2.8, terrainHeight(-2.8, 5), 5);
  const stones = new THREE.MeshStandardMaterial({ color: '#827d6c', flatShading: true });
  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * Math.PI * 2;
    const rock = addOutlinedMesh(camp, new THREE.DodecahedronGeometry(0.38, 0), stones, 22, 0.62);
    rock.position.set(Math.cos(angle) * 1.0, 0.22, Math.sin(angle) * 0.75);
    rock.scale.set(1, 0.55, 0.8);
  }
  const ember = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.65, 5),
    new THREE.MeshStandardMaterial({ color: '#d7864e', emissive: '#6c2b19', emissiveIntensity: 0.4 })
  );
  ember.position.y = 0.45;
  camp.add(ember);
  scene.add(camp);
}

function addFenceAndSettlementDetails(): void {
  const fence = new THREE.Group();
  fence.position.set(-7, terrainHeight(-7, 1), 1);
  const wood = new THREE.MeshStandardMaterial({ color: '#79583e', flatShading: true, roughness: 1 });
  const lightWood = new THREE.MeshStandardMaterial({ color: '#b18a5e', flatShading: true, roughness: 1 });

  const addPost = (x: number, z: number, height = 1.12): void => {
    const post = addOutlinedMesh(fence, new THREE.CylinderGeometry(0.11, 0.15, height, 6), wood, 25, 0.55);
    post.position.set(x, height / 2, z);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.2, 6), lightWood);
    cap.position.set(x, height + 0.05, z);
    fence.add(cap);
  };
  const addRail = (x1: number, x2: number, y: number, z: number): void => {
    const length = Math.abs(x2 - x1);
    const rail = addOutlinedMesh(fence, new THREE.CylinderGeometry(0.065, 0.075, length, 6), lightWood, 25, 0.5);
    rail.rotation.z = Math.PI / 2;
    rail.position.set((x1 + x2) / 2, y, z);
  };
  for (const z of [-5.3, 7.5]) {
    for (let x = -9.5; x <= 9.5; x += 2.35) addPost(x, z);
    addRail(-9.5, 9.5, 0.42, z);
    addRail(-9.5, 9.5, 0.83, z);
  }
  for (const x of [-9.5, 9.5]) {
    for (let z = -5.3; z <= 7.5; z += 2.5) addPost(x, z);
    const rail1 = addOutlinedMesh(fence, new THREE.CylinderGeometry(0.065, 0.075, 12.8, 6), lightWood, 25, 0.5);
    rail1.rotation.x = Math.PI / 2;
    rail1.position.set(x, 0.42, 1.1);
    const rail2 = addOutlinedMesh(fence, new THREE.CylinderGeometry(0.065, 0.075, 12.8, 6), lightWood, 25, 0.5);
    rail2.rotation.x = Math.PI / 2;
    rail2.position.set(x, 0.83, 1.1);
  }
  scene.add(fence);

  const sign = new THREE.Group();
  sign.position.set(2.4, terrainHeight(2.4, 11.5), 11.5);
  const post = addOutlinedMesh(sign, new THREE.CylinderGeometry(0.12, 0.16, 2.35, 7), wood, 24, 0.62);
  post.position.y = 1.17;
  const board = addOutlinedMesh(sign, new THREE.BoxGeometry(2.2, 0.76, 0.16), lightWood, 20, 0.66);
  board.position.set(0.15, 1.75, 0);
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 160;
  const ctx = labelCanvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#b18a5e';
    ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = '#594633';
    ctx.lineWidth = 7;
    ctx.strokeRect(9, 9, 494, 142);
    ctx.fillStyle = '#46372d';
    ctx.font = 'bold 54px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EVERROOT', 256, 83);
    const texture = new THREE.CanvasTexture(labelCanvas);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1.95, 0.61),
      new THREE.MeshBasicMaterial({ map: texture, transparent: false })
    );
    face.position.set(0.15, 1.75, 0.091);
    sign.add(face);
  }
  scene.add(sign);

  const crate = new THREE.Group();
  crate.position.set(-11.1, terrainHeight(-11.1, 4.9), 4.9);
  const crateBody = addOutlinedMesh(crate, new THREE.BoxGeometry(1.05, 0.88, 0.92), lightWood, 22, 0.62);
  crateBody.position.y = 0.45;
  for (let y = 0.22; y <= 0.68; y += 0.46) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.98), wood);
    strip.position.y = y;
    crate.add(strip);
  }
  scene.add(crate);

  const barrel = new THREE.Group();
  barrel.position.set(-12.6, terrainHeight(-12.6, 3.8), 3.8);
  const body = addOutlinedMesh(barrel, new THREE.CylinderGeometry(0.43, 0.48, 1.12, 9), wood, 22, 0.6);
  body.position.y = 0.56;
  for (const y of [0.2, 0.91]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.045, 5, 12), lightWood);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    barrel.add(hoop);
  }
  scene.add(barrel);
}

function addPond(): void {
  const x = 24;
  const z = -22;
  const pond = new THREE.Group();
  pond.position.set(x, terrainHeight(x, z) + 0.06, z);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(6.3, 40),
    new THREE.MeshStandardMaterial({ color: '#82aaa2', roughness: 0.3, metalness: 0.02 })
  );
  water.rotation.x = -Math.PI / 2;
  water.scale.set(1.28, 0.68, 1);
  pond.add(water);
  const shore = new THREE.Mesh(
    new THREE.TorusGeometry(7.0, 0.16, 5, 48),
    new THREE.MeshStandardMaterial({ color: '#b2a17b', roughness: 1 })
  );
  shore.rotation.x = Math.PI / 2;
  shore.scale.set(1.2, 0.66, 1);
  pond.add(shore);
  for (let i = 0; i < 2; i++) {
    const ripple = new THREE.Mesh(
      new THREE.TorusGeometry(1.4 + i * 1.15, 0.035, 4, 40),
      new THREE.MeshBasicMaterial({ color: '#e0e9cf', transparent: true, opacity: 0.4, depthWrite: false })
    );
    ripple.rotation.x = Math.PI / 2;
    ripple.position.y = 0.08 + i * 0.012;
    ripple.scale.set(1.2, 0.66, 1);
    ripple.userData.phase = i * Math.PI;
    pond.add(ripple);
    waterRipples.push(ripple);
  }
  scene.add(pond);
}

function addStone(x: number, z: number, size: number): void {
  const group = new THREE.Group();
  group.position.set(x, terrainHeight(x, z), z);
  const stone = addOutlinedMesh(
    group,
    new THREE.DodecahedronGeometry(size, 0),
    new THREE.MeshStandardMaterial({ color: '#9b9b88', flatShading: true, roughness: 1 }),
    18,
    0.68
  );
  stone.position.y = size * 0.45;
  stone.rotation.set(0.2, seeded(x * 9 + z) * 2, 0.1);
  stone.scale.set(1.2, 0.78, 0.9);
  scene.add(group);
}

function addLog(x: number, z: number): void {
  const log = new THREE.Group();
  log.position.set(x, terrainHeight(x, z) + 0.35, z);
  const wood = addOutlinedMesh(
    log,
    new THREE.CylinderGeometry(0.28, 0.34, 2.4, 8),
    new THREE.MeshStandardMaterial({ color: '#986e48', flatShading: true }),
    18
  );
  wood.rotation.z = Math.PI / 2;
  wood.rotation.x = 0.12;
  scene.add(log);
}

function addFloatingSeeds(): void {
  const seedMaterial = new THREE.MeshBasicMaterial({
    color: '#f2e6b9', transparent: true, opacity: 0.78, depthWrite: false
  });
  for (let i = 0; i < 18; i++) {
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.045 + seeded(i + 9000) * 0.035, 6, 5), seedMaterial);
    seed.position.set(seeded(i + 9100) * 46 - 23, 1.5 + seeded(i + 9200) * 5, seeded(i + 9300) * 42 - 25);
    seed.userData.phase = seeded(i + 9400) * Math.PI * 2;
    seed.userData.originY = seed.position.y;
    scene.add(seed);
    floatingSeeds.push(seed);
  }
}

function addFlowers(): void {
  const linePositions: number[] = [];
  for (let i = 0; i < 230; i++) {
    const x = seeded(i + 13) * 84 - 42;
    const z = seeded(i + 800) * 84 - 42;
    if (Math.abs(x + 7) < 9 && Math.abs(z - 1) < 8) continue;
    const y = terrainHeight(x, z) + 0.08;
    linePositions.push(x, y, z, x + (seeded(i + 1900) - 0.5) * 0.22, y + 0.2, z + (seeded(i + 2100) - 0.5) * 0.2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: '#e7d9a1',
    transparent: true,
    opacity: 0.58
  })));
  for (let i = 0; i < 34; i++) {
    const x = seeded(i + 700) * 72 - 36;
    const z = seeded(i + 1400) * 72 - 36;
    const flower = new THREE.Group();
    flower.position.set(x, terrainHeight(x, z) + 0.14, z);
    const petal = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 7, 5),
      new THREE.MeshStandardMaterial({ color: i % 2 ? '#e9b77d' : '#e5d8bd', flatShading: true })
    );
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 6, 4),
      new THREE.MeshStandardMaterial({ color: '#a46b46' })
    );
    flower.add(petal, center);
    center.position.y = 0.06;
    scene.add(flower);
  }
}

function makeResource(kind: ResourceKind, x: number, z: number): void {
  const group = new THREE.Group();
  group.position.set(x, terrainHeight(x, z), z);
  if (kind === 'berries') {
    const leaves = new THREE.MeshStandardMaterial({ color: '#607d48', flatShading: true });
    const berry = new THREE.MeshStandardMaterial({ color: '#b95e67', flatShading: true });
    const bush = addOutlinedMesh(group, new THREE.IcosahedronGeometry(0.58, 1), leaves, 20, 0.7);
    bush.position.y = 0.48;
    for (let i = 0; i < 5; i++) {
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 6), berry);
      fruit.position.set(Math.sin(i * 2.2) * 0.39, 0.55 + (i % 2) * 0.23, Math.cos(i * 2.2) * 0.42);
      group.add(fruit);
    }
  } else if (kind === 'wood') {
    const timber = addOutlinedMesh(
      group,
      new THREE.CylinderGeometry(0.2, 0.2, 1.8, 7),
      new THREE.MeshStandardMaterial({ color: '#a57950', flatShading: true }),
      18
    );
    timber.rotation.z = Math.PI / 2;
    timber.position.y = 0.2;
    const second = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.45, 7), timber.material);
    second.rotation.set(0.16, 0, -Math.PI / 2.6);
    second.position.set(0.08, 0.44, 0.28);
    group.add(second);
  } else {
    const stone = addOutlinedMesh(
      group,
      new THREE.DodecahedronGeometry(0.52, 0),
      new THREE.MeshStandardMaterial({ color: '#9da294', flatShading: true }),
      18
    );
    stone.position.y = 0.38;
  }
  scene.add(group);
  resources.push({ kind, group, position: new THREE.Vector3(x, 0, z), active: true });
}

function addTraveller(): void {
  const coat = new THREE.MeshStandardMaterial({ color: '#b76b50', roughness: 1, flatShading: true });
  const cloth = new THREE.MeshStandardMaterial({ color: '#d5b77e', roughness: 1, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: '#dcae82', roughness: 1, flatShading: true });
  const hair = new THREE.MeshStandardMaterial({ color: '#4d4035', roughness: 1, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#51473d', roughness: 1, flatShading: true });
  const body = addOutlinedMesh(playerVisual, new THREE.CylinderGeometry(0.37, 0.48, 1.15, 7), coat, 18);
  body.position.y = 1.0;
  body.scale.set(1, 1, 0.82);
  const scarf = addOutlinedMesh(playerVisual, new THREE.TorusGeometry(0.34, 0.1, 5, 9), cloth, 20);
  scarf.position.y = 1.55;
  scarf.rotation.x = Math.PI / 2;
  const head = addOutlinedMesh(playerVisual, new THREE.SphereGeometry(0.39, 9, 7), skin, 22);
  head.position.set(0, 1.85, -0.05);
  const cap = addOutlinedMesh(playerVisual, new THREE.SphereGeometry(0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 22);
  cap.position.set(0, 2.02, -0.05);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#3b3029' });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), eyeMaterial);
    eye.position.set(side * 0.14, 1.88, -0.405);
    playerVisual.add(eye);
  }
  const backpack = addOutlinedMesh(playerVisual, new THREE.BoxGeometry(0.62, 0.74, 0.28), dark, 18, 0.7);
  backpack.position.set(0, 1.04, 0.43);
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.48, 1.38, 0);
    const arm = addOutlinedMesh(armPivot, new THREE.CylinderGeometry(0.12, 0.15, 0.72, 7), coat, 18);
    arm.position.y = -0.3;
    arm.rotation.z = side * -0.12;
    playerVisual.add(armPivot);
    arms.push(armPivot);
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.22, 0.55, 0);
    const leg = addOutlinedMesh(legPivot, new THREE.CylinderGeometry(0.13, 0.16, 0.66, 7), dark, 18);
    leg.position.y = -0.29;
    playerVisual.add(legPivot);
    arms.push(legPivot);
  }
  player.userData.limbs = arms;
  player.add(playerVisual);
  player.position.set(0, terrainHeight(0, 9), 9);
  scene.add(player);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.76, 20),
    new THREE.MeshBasicMaterial({ color: '#384438', transparent: true, opacity: 0.22, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.035;
  player.add(shadow);
}

function addCritter(x: number, z: number, shade: string, phase: number): void {
  const group = new THREE.Group();
  group.position.set(x, terrainHeight(x, z), z);
  const fur = new THREE.MeshStandardMaterial({ color: shade, flatShading: true, roughness: 1 });
  const body = addOutlinedMesh(group, new THREE.IcosahedronGeometry(0.55, 1), fur, 19, 0.72);
  body.position.set(0, 0.52, 0.04);
  body.scale.set(1.2, 0.82, 0.9);
  const head = addOutlinedMesh(group, new THREE.SphereGeometry(0.36, 8, 7), fur, 20, 0.72);
  head.position.set(0.38, 0.83, -0.12);
  for (const side of [-1, 1]) {
    const ear = addOutlinedMesh(group, new THREE.ConeGeometry(0.13, 0.65, 6), fur, 18, 0.65);
    ear.position.set(0.26 + side * 0.2, 1.33, -0.13);
    ear.rotation.z = side * -0.23;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: '#342d28' }));
    eye.position.set(0.63, 0.91, side * 0.19 - 0.17);
    group.add(eye);
  }
  const tail = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 7, 6),
    new THREE.MeshStandardMaterial({ color: '#f0dfc3', flatShading: true })
  );
  tail.position.set(-0.58, 0.7, 0.1);
  group.add(tail);
  scene.add(group);
  critters.push({ group, home: new THREE.Vector3(x, 0, z), phase });
}

function createWorld(): void {
  const hemisphere = new THREE.HemisphereLight('#f4f2da', '#68785b', 2.15);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#fff0d2', 2.35);
  sun.position.set(-18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  addDistantLandscape();
  addGround();
  addPath();
  addHut();
  addFenceAndSettlementDetails();
  addPond();

  let treeCount = 0;
  for (let i = 0; i < 180 && treeCount < 52; i++) {
    const x = seeded(i + 200) * 88 - 44;
    const z = seeded(i + 500) * 88 - 44;
    const inClearing = Math.abs(x + 7) < 11 && Math.abs(z - 1) < 10;
    const inPond = ((x - 24) / 9) ** 2 + ((z + 22) / 7) ** 2 < 1.1;
    const byTrail = Math.abs(x + z * 0.5 - 1) < 3.4;
    if (inClearing || inPond || byTrail) continue;
    addTree(x, z, 0.72 + seeded(i + 900) * 0.48);
    treeCount++;
  }
  addStone(9, 15, 0.85);
  addStone(12, 16.4, 0.65);
  addStone(-22, -8, 1.0);
  addStone(30, 9, 0.82);
  addLog(4.5, 15);
  addLog(-18, 12);
  addFlowers();
  addGrass();
  addFloatingSeeds();

  makeResource('berries', 6, -3);
  makeResource('wood', -15, 13);
  makeResource('stone', 13, 12);
  makeResource('berries', 28, 3);
  makeResource('wood', -27, -8);
  makeResource('stone', 31, -12);

  addTraveller();
  addCritter(12, -2, '#c68e68', 0.6);
  addCritter(-18, -15, '#d9c6a7', 2.1);
  addCritter(31, 18, '#9eaa83', 3.7);

  camera.position.set(0, 11, 22);
  camera.lookAt(0, 1, 6);
}

function updateStats(): void {
  ui.stats.textContent = `♥ 5   •   Berries ${inventory.berries}   •   Wood ${inventory.wood}   •   Stone ${inventory.stone}`;
}

function showMessage(text: string): void {
  ui.message.textContent = text;
  ui.message.classList.add('visible');
  window.clearTimeout(Number(ui.message.dataset.timer || 0));
  const timer = window.setTimeout(() => ui.message.classList.remove('visible'), 2600);
  ui.message.dataset.timer = String(timer);
}

function saveGame(): void {
  try {
    const save: SaveData = {
      player: { x: player.position.x, z: player.position.z },
      inventory: { ...inventory }
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    showMessage('Your journey has been saved.');
  } catch {
    showMessage('This browser could not save progress.');
  }
}

function loadGame(): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Partial<SaveData>;
    if (data.player && Number.isFinite(data.player.x) && Number.isFinite(data.player.z)) {
      player.position.x = THREE.MathUtils.clamp(data.player.x, -LIMIT, LIMIT);
      player.position.z = THREE.MathUtils.clamp(data.player.z, -LIMIT, LIMIT);
      player.position.y = terrainHeight(player.position.x, player.position.z);
    }
    if (data.inventory) {
      for (const key of ['berries', 'wood', 'stone'] as const) {
        const value = data.inventory[key];
        if (typeof value === 'number' && Number.isFinite(value)) inventory[key] = Math.max(0, Math.floor(value));
      }
    }
    updateStats();
  } catch {
    localStorage.removeItem(SAVE_KEY);
  }
}

function interact(): void {
  let closest: ResourceNode | null = null;
  let nearest = 4.1;
  for (const node of resources) {
    if (!node.active) continue;
    const distance = Math.hypot(player.position.x - node.position.x, player.position.z - node.position.z);
    if (distance < nearest) {
      nearest = distance;
      closest = node;
    }
  }
  if (closest) {
    closest.active = false;
    closest.group.visible = false;
    inventory[closest.kind] += closest.kind === 'stone' ? 1 : 2;
    updateStats();
    showMessage(closest.kind === 'berries' ? 'A handful of wild berries. The forest is generous.' : `Collected ${closest.kind} for the settlement.`);
    if ('vibrate' in navigator) navigator.vibrate(12);
    saveGame();
    return;
  }

  const critter = critters.find((item) =>
    Math.hypot(player.position.x - item.group.position.x, player.position.z - item.group.position.z) < 3.2
  );
  if (critter) {
    showMessage('A little forest friend pauses to say hello.');
    return;
  }

  if (Math.hypot(player.position.x + 7, player.position.z - 1) < 7) {
    showMessage('Home, for now. There are many stories beyond this clearing.');
  } else {
    showMessage('Nothing nearby to gather. Follow the winding trail.');
  }
}

function setJoystick(event: PointerEvent): void {
  const rect = ui.joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const length = Math.max(1, Math.hypot(dx, dy));
  const scale = Math.min(1, 36 / length);
  joystickX = dx / 36 * scale;
  joystickY = dy / 36 * scale;
  ui.knob.style.transform = `translate(${joystickX * 36}px, ${joystickY * 36}px)`;
}

ui.joystick.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  joystickPointer = event.pointerId;
  ui.joystick.setPointerCapture(event.pointerId);
  setJoystick(event);
});
ui.joystick.addEventListener('pointermove', (event) => {
  if (event.pointerId === joystickPointer) setJoystick(event);
});
const releaseJoystick = (event: PointerEvent): void => {
  if (event.pointerId !== joystickPointer) return;
  joystickPointer = null;
  joystickX = 0;
  joystickY = 0;
  ui.knob.style.transform = 'translate(0, 0)';
};
ui.joystick.addEventListener('pointerup', releaseJoystick);
ui.joystick.addEventListener('pointercancel', releaseJoystick);
ui.interact.addEventListener('click', interact);
ui.save?.addEventListener('click', saveGame);

const keys = new Set<string>();
window.addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase());
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(event.key.toLowerCase())) event.preventDefault();
  if (event.key.toLowerCase() === 'e' || event.key === ' ') interact();
  if (event.key.toLowerCase() === 'escape') saveGame();
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const point = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, point)) {
    if (Math.hypot(point.x - player.position.x, point.z - player.position.z) > 2.1) {
      targetPosition = new THREE.Vector3(
        THREE.MathUtils.clamp(point.x, -LIMIT, LIMIT),
        0,
        THREE.MathUtils.clamp(point.z, -LIMIT, LIMIT)
      );
    }
  }
});

function resize(): void {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height);
}
window.addEventListener('resize', resize);

function animateEnvironment(time: number): void {
  windTrees.forEach(({ group, phase, strength }) => {
    group.rotation.z = Math.sin(time * 0.55 + phase) * strength;
    group.rotation.x = Math.cos(time * 0.42 + phase) * strength * 0.65;
  });
  waterRipples.forEach((ripple) => {
    const phase = time * 0.42 + Number(ripple.userData.phase || 0);
    const pulse = (Math.sin(phase) + 1) / 2;
    const scale = 0.82 + pulse * 0.46;
    ripple.scale.set(1.2 * scale, 0.66 * scale, 1);
    (ripple.material as THREE.MeshBasicMaterial).opacity = 0.16 + (1 - pulse) * 0.3;
  });
  floatingSeeds.forEach((seed) => {
    seed.position.y = Number(seed.userData.originY) + Math.sin(time * 0.7 + Number(seed.userData.phase)) * 0.34;
    seed.position.x += Math.sin(time * 0.24 + Number(seed.userData.phase)) * 0.0008;
  });
}

function animateCritters(time: number): void {
  critters.forEach((critter, index) => {
    const drift = Math.sin(time * 0.65 + critter.phase) * 0.8;
    critter.group.position.x = critter.home.x + drift;
    critter.group.position.z = critter.home.z + Math.cos(time * 0.5 + critter.phase) * 0.35;
    critter.group.position.y = terrainHeight(critter.group.position.x, critter.group.position.z)
      + 0.04 + Math.abs(Math.sin(time * 2.2 + index)) * 0.08;
    critter.group.rotation.y = Math.sin(time * 0.5 + critter.phase) * 0.16;
  });
}

function animate(): void {
  const delta = Math.min(clock.getDelta(), 0.04);
  elapsed += delta;

  let dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
  let dz = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
  if (joystickPointer !== null) {
    dx = joystickX;
    dz = joystickY;
  }
  const length = Math.hypot(dx, dz);
  if (length > 0.12) {
    targetPosition = null;
    dx /= Math.max(1, length);
    dz /= Math.max(1, length);
  } else if (targetPosition) {
    dx = targetPosition.x - player.position.x;
    dz = targetPosition.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.45) {
      targetPosition = null;
      dx = 0;
      dz = 0;
    } else {
      dx /= distance;
      dz /= distance;
    }
  } else {
    dx = 0;
    dz = 0;
  }

  playerMoving = Math.hypot(dx, dz) > 0.01;
  if (playerMoving) {
    player.position.x = THREE.MathUtils.clamp(player.position.x + dx * 7.2 * delta, -LIMIT, LIMIT);
    player.position.z = THREE.MathUtils.clamp(player.position.z + dz * 7.2 * delta, -LIMIT, LIMIT);
    player.rotation.y = Math.atan2(dx, -dz);
  }
  player.position.y = terrainHeight(player.position.x, player.position.z) + (playerMoving ? Math.abs(Math.sin(elapsed * 9)) * 0.055 : 0);
  playerVisual.position.y = playerMoving ? Math.sin(elapsed * 9) * 0.035 : Math.sin(elapsed * 2.2) * 0.018;
  const limbs = player.userData.limbs as THREE.Group[];
  limbs.forEach((limb, index) => {
    limb.rotation.x = playerMoving ? Math.sin(elapsed * 9 + index * Math.PI) * 0.32 : 0;
  });

  animateEnvironment(elapsed);
  animateCritters(elapsed);
  const desiredCamera = new THREE.Vector3(player.position.x, player.position.y + 10.5, player.position.z + 16.5);
  camera.position.lerp(desiredCamera, 1 - Math.pow(0.001, delta));
  camera.lookAt(player.position.x, player.position.y + 1.0, player.position.z - 1.3);
  renderer.render(scene, camera);
}

try {
  createWorld();
  loadGame();
  updateStats();
  resize();
  renderer.setAnimationLoop(animate);
  ui.loading.classList.add('hidden');
  showMessage('Welcome to Everroot. Follow the trail and see what grows.');
} catch (error) {
  console.error(error);
  ui.loading.classList.add('hidden');
  ui.error.classList.add('visible');
  ui.error.textContent = error instanceof Error
    ? `Everroot could not start: ${error.message}`
    : 'Everroot could not start on this browser.';
}
