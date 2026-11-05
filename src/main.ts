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

function makeTerrainTexture(): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = size;
  bumpCanvas.width = bumpCanvas.height = size;
  const colorContext = colorCanvas.getContext('2d');
  const bumpContext = bumpCanvas.getContext('2d');
  if (!colorContext || !bumpContext) throw new Error('Terrain texture creation is unavailable.');
  colorContext.fillStyle = '#718451';
  colorContext.fillRect(0, 0, size, size);
  bumpContext.fillStyle = '#888888';
  bumpContext.fillRect(0, 0, size, size);
  for (let i = 0; i < 26000; i++) {
    const x = seeded(i + 14000) * size;
    const y = seeded(i + 28000) * size;
    const radius = 1 + seeded(i + 42000) * 8;
    const alpha = 0.025 + seeded(i + 56000) * 0.085;
    colorContext.fillStyle = i % 5 === 0
      ? 'rgba(202,185,126,' + alpha + ')'
      : 'rgba(27,55,28,' + alpha + ')';
    colorContext.beginPath();
    colorContext.ellipse(x, y, radius, radius * (0.28 + seeded(i + 70000) * 0.6), seeded(i + 84000), 0, Math.PI * 2);
    colorContext.fill();
    const shade = Math.floor(72 + seeded(i + 98000) * 120);
    bumpContext.fillStyle = 'rgba(' + shade + ',' + shade + ',' + shade + ',0.22)';
    bumpContext.beginPath();
    bumpContext.ellipse(x, y, radius, radius * 0.48, 0, 0, Math.PI * 2);
    bumpContext.fill();
  }
  for (let i = 0; i < 2000; i++) {
    const x = seeded(i + 120000) * size;
    const y = seeded(i + 124000) * size;
    colorContext.strokeStyle = i % 3 === 0 ? 'rgba(210,197,143,.16)' : 'rgba(37,70,38,.12)';
    colorContext.lineWidth = 0.6 + seeded(i + 128000) * 1.1;
    colorContext.beginPath();
    colorContext.moveTo(x, y);
    colorContext.lineTo(x + 2 + seeded(i + 132000) * 9, y - 1 - seeded(i + 136000) * 5);
    colorContext.stroke();
  }
  const color = new THREE.CanvasTexture(colorCanvas);
  color.wrapS = color.wrapT = THREE.RepeatWrapping;
  color.repeat.set(9, 9);
  color.colorSpace = THREE.SRGBColorSpace;
  color.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.copy(color.repeat);
  bump.anisotropy = color.anisotropy;
  return { color, bump };
}

function makeBarkMaterial(): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.MeshStandardMaterial({ color: '#806044', roughness: 1 });
  context.fillStyle = '#76563d';
  context.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 650; i++) {
    const x = seeded(i + 141) * 256;
    context.strokeStyle = i % 3 ? 'rgba(42,28,20,.23)' : 'rgba(207,160,104,.22)';
    context.lineWidth = 1 + seeded(i + 282) * 8;
    context.beginPath();
    context.moveTo(x, 0);
    context.bezierCurveTo(x + 9, 130, x - 12, 340, x + (seeded(i + 423) - 0.5) * 22, 512);
    context.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 2);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.94, bumpMap: map, bumpScale: 0.12 });
}

function makeRockMaterial(): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.MeshStandardMaterial({ color: '#77796c', roughness: 0.94 });
  context.fillStyle = '#858779';
  context.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const x = seeded(i + 21000) * 256;
    const y = seeded(i + 31000) * 256;
    const size = 0.5 + seeded(i + 41000) * 2.4;
    const shade = Math.floor(78 + seeded(i + 51000) * 115);
    context.fillStyle = 'rgba(' + shade + ',' + shade + ',' + (shade - 5) + ',0.18)';
    context.fillRect(x, y, size, size);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.96, bumpMap: map, bumpScale: 0.08 });
}

function makeLeafMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.84, metalness: 0, side: THREE.DoubleSide });
}

function addOutlinedMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  _threshold = 24,
  _opacity = 0.76
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

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
  const segments = 128;
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
  terrainGeometry = geometry;
  const maps = makeTerrainTexture();
  const ground = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: maps.color,
      bumpMap: maps.bump,
      bumpScale: 0.095,
      roughness: 0.96,
      metalness: 0
    })
  );
  ground.receiveShadow = true;
  terrainMesh = ground;
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
  const bladeCount = 2350;
  const bladeGeometry = new THREE.ConeGeometry(0.035, 0.42, 5, 2);
  bladeGeometry.translate(0, 0.21, 0);
  const grassMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, vertexColors: true });
  const grass = new THREE.InstancedMesh(bladeGeometry, grassMaterial, bladeCount);
  grass.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let count = 0;
  for (let i = 0; i < bladeCount * 2 && count < bladeCount; i++) {
    const x = seeded(i + 3310) * 88 - 44;
    const z = seeded(i + 7710) * 88 - 44;
    const onClearing = Math.abs(x + 7) < 8.5 && Math.abs(z - 1) < 7;
    const onPond = ((x - 24) / 8.6) ** 2 + ((z + 22) / 6.4) ** 2 < 1;
    const onPath = Math.abs(x + z * 0.5 - 1) < 2.4;
    if (onClearing || onPond || onPath) continue;
    dummy.position.set(x, terrainHeight(x, z), z);
    dummy.rotation.set((seeded(i + 1001) - 0.5) * 0.12, seeded(i + 1002) * Math.PI * 2, (seeded(i + 1003) - 0.5) * 0.22);
    const height = 0.65 + seeded(i + 1004) * 0.8;
    dummy.scale.set(0.75 + seeded(i + 1005) * 0.6, height, 0.75 + seeded(i + 1006) * 0.6);
    dummy.updateMatrix();
    grass.setMatrixAt(count, dummy.matrix);
    tint.setHSL(0.22 + seeded(i + 1007) * 0.045, 0.23 + seeded(i + 1008) * 0.17, 0.32 + seeded(i + 1009) * 0.19);
    grass.setColorAt(count, tint);
    count++;
  }
  grass.count = count;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  grass.castShadow = false;
  grass.receiveShadow = true;
  scene.add(grass);
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
  const trunkHeight = 2.65 * scale;
  const trunkMaterial = makeBarkMaterial();
  const trunk = addOutlinedMesh(tree, new THREE.CylinderGeometry(0.28 * scale, 0.43 * scale, trunkHeight, 24, 5), trunkMaterial);
  trunk.position.y = trunkHeight * 0.5;
  const branchSpecs = [
    [-0.35, 1.05, -0.85, 2.28, 0.08],
    [0.18, 1.12, 0.72, 2.34, -0.1],
    [-0.12, 1.48, -0.12, 2.95, 0.16],
    [0.18, 1.65, 0.34, 3.15, 0.08]
  ];
  for (const [sx, sy, ex, ey, ez] of branchSpecs) {
    const start = new THREE.Vector3(sx * scale, sy * scale, 0);
    const end = new THREE.Vector3(ex * scale, ey * scale, ez * scale);
    const direction = end.clone().sub(start);
    const branch = addOutlinedMesh(tree, new THREE.CylinderGeometry(0.075 * scale, 0.15 * scale, direction.length(), 16, 3), trunkMaterial);
    branch.position.copy(start).add(end).multiplyScalar(0.5);
    branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  }
  const palette = [
    ['#315a3d', '#477249', '#5d8452'],
    ['#365e43', '#527d4e', '#73915c'],
    ['#3c6240', '#5f8050', '#84975a'],
    ['#2e5546', '#47725d', '#6e8b70']
  ];
  const colors = palette[Math.floor(seeded(x * 17 + z * 3) * palette.length)];
  const canopies = [
    { x: -0.75, y: 2.95, z: 0.05, r: 1.52 },
    { x: 0.68, y: 3.13, z: -0.15, r: 1.42 },
    { x: -0.12, y: 4.05, z: 0.14, r: 1.24 },
    { x: -1.15, y: 3.52, z: -0.15, r: 1.05 },
    { x: 1.18, y: 3.55, z: 0.1, r: 1.1 }
  ];
  for (let i = 0; i < canopies.length; i++) {
    const crown = canopies[i];
    const canopy = addOutlinedMesh(tree, new THREE.SphereGeometry(crown.r * scale, 24, 18), makeLeafMaterial(colors[i % colors.length]));
    canopy.position.set(crown.x * scale, crown.y * scale, crown.z * scale);
    canopy.scale.set(1.08, 0.9 + (i % 2) * 0.12, 1);
  }
  const leafGeometry = new THREE.SphereGeometry(0.135 * scale, 9, 7);
  const leaves = new THREE.InstancedMesh(leafGeometry, makeLeafMaterial(colors[1]), 54);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 54; i++) {
    const angle = seeded(i + x * 31 + z * 17) * Math.PI * 2;
    const radius = 0.65 + seeded(i + x * 19 + z * 23) * 1.12;
    const y = 2.65 + seeded(i + x * 13 + z * 29) * 1.9;
    dummy.position.set(Math.cos(angle) * radius * scale, y * scale, Math.sin(angle) * radius * 0.78 * scale);
    dummy.scale.set(0.9 + seeded(i + 71) * 0.9, 0.55 + seeded(i + 83) * 0.7, 0.8 + seeded(i + 97) * 0.8);
    dummy.rotation.set(seeded(i + 101) * 0.6, angle, seeded(i + 113) * 0.6);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
  }
  leaves.instanceMatrix.needsUpdate = true;
  tree.add(leaves);
  tree.userData.windPhase = seeded(x * 21 + z * 7) * Math.PI * 2;
  tree.userData.windStrength = 0.006 + seeded(x + z * 5) * 0.007;
  windTrees.push({ group: tree, phase: tree.userData.windPhase, strength: tree.userData.windStrength });
  treeObstacles.push({ x, z, radius: 0.43 * scale, height: trunkHeight });
  scene.add(tree);
}

function addHut(): void {
  const hut = new THREE.Group();
  const x = -7;
  const z = 1;
  hut.position.set(x, terrainHeight(x, z), z);
  const wall = new THREE.MeshStandardMaterial({ color: '#cbb892', roughness: 0.92, bumpScale: 0.025 });
  const roof = new THREE.MeshStandardMaterial({ color: '#875044', roughness: 0.94 });
  const darkWood = makeBarkMaterial();
  const plaster = addOutlinedMesh(hut, new THREE.BoxGeometry(5.2, 3.1, 4.4), wall);
  plaster.position.y = 1.58;
  const roofFront = addOutlinedMesh(hut, new THREE.BoxGeometry(6.15, 0.28, 3.25), roof);
  roofFront.position.set(0, 3.22, 0.92);
  roofFront.rotation.x = -0.48;
  const roofBack = addOutlinedMesh(hut, new THREE.BoxGeometry(6.15, 0.28, 3.25), roof);
  roofBack.position.set(0, 3.22, -0.92);
  roofBack.rotation.x = 0.48;
  boxObstacles.push({ x, y: terrainHeight(x, z) + 1.55, z, hx: 2.6, hy: 1.55, hz: 2.2 });
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
  const stones = makeRockMaterial();
  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * Math.PI * 2;
    const rock = addOutlinedMesh(camp, new THREE.DodecahedronGeometry(0.38, 0), stones, 22, 0.62);
    rock.position.set(Math.cos(angle) * 1.0, 0.22, Math.sin(angle) * 0.75);
    rock.scale.set(1, 0.55, 0.8);
  }
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 18, 12),
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
    new THREE.SphereGeometry(size, 24, 18),
    makeRockMaterial(),
    18,
    0.68
  );
  stone.position.y = size * 0.45;
  stone.rotation.set(0.2, seeded(x * 9 + z) * 2, 0.1);
  stone.scale.set(1.2, 0.78, 0.9);
  rockObstacles.push({ x, z, radius: size * 0.92 });
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
    const bush = addOutlinedMesh(group, new THREE.SphereGeometry(0.58, 20, 16), leaves, 20, 0.7);
    bush.position.y = 0.48;
    for (let i = 0; i < 5; i++) {
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), berry);
      fruit.position.set(Math.sin(i * 2.2) * 0.39, 0.55 + (i % 2) * 0.23, Math.cos(i * 2.2) * 0.42);
      group.add(fruit);
    }
  } else if (kind === 'wood') {
    const timber = addOutlinedMesh(
      group,
      new THREE.CylinderGeometry(0.2, 0.2, 1.8, 18, 2),
      new THREE.MeshStandardMaterial({ color: '#a57950', flatShading: true }),
      18
    );
    timber.rotation.z = Math.PI / 2;
    timber.position.y = 0.2;
    const second = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.45, 16, 2), timber.material);
    second.rotation.set(0.16, 0, -Math.PI / 2.6);
    second.position.set(0.08, 0.44, 0.28);
    group.add(second);
  } else {
    const stone = addOutlinedMesh(
      group,
      new THREE.SphereGeometry(0.52, 22, 16),
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
  const body = addOutlinedMesh(playerVisual, new THREE.CylinderGeometry(0.37, 0.48, 1.15, 24, 4), coat);
  body.position.y = 1.0;
  body.scale.set(1, 1, 0.82);
  const scarf = addOutlinedMesh(playerVisual, new THREE.TorusGeometry(0.34, 0.1, 10, 28), cloth);
  scarf.position.y = 1.55;
  scarf.rotation.x = Math.PI / 2;
  const head = addOutlinedMesh(playerVisual, new THREE.SphereGeometry(0.39, 24, 18), skin);
  head.position.set(0, 1.85, -0.05);
  const cap = addOutlinedMesh(playerVisual, new THREE.SphereGeometry(0.4, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.position.set(0, 2.02, -0.05);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#3b3029' });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), eyeMaterial);
    eye.position.set(side * 0.14, 1.88, -0.405);
    playerVisual.add(eye);
  }
  const backpack = addOutlinedMesh(playerVisual, new THREE.BoxGeometry(0.62, 0.74, 0.28), dark, 18, 0.7);
  backpack.position.set(0, 1.04, 0.43);
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.48, 1.38, 0);
    const arm = addOutlinedMesh(armPivot, new THREE.CylinderGeometry(0.12, 0.15, 0.72, 16, 3), coat);
    arm.position.y = -0.3;
    arm.rotation.z = side * -0.12;
    playerVisual.add(armPivot);
    arms.push(armPivot);
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.22, 0.55, 0);
    const leg = addOutlinedMesh(legPivot, new THREE.CylinderGeometry(0.13, 0.16, 0.66, 16, 3), dark);
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
  const body = addOutlinedMesh(group, new THREE.SphereGeometry(0.55, 24, 18), fur);
  body.position.set(0, 0.52, 0.04);
  body.scale.set(1.2, 0.82, 0.9);
  const head = addOutlinedMesh(group, new THREE.SphereGeometry(0.36, 20, 16), fur, 0.72);
  head.position.set(0.38, 0.83, -0.12);
  for (const side of [-1, 1]) {
    const ear = addOutlinedMesh(group, new THREE.SphereGeometry(0.17, 16, 12), fur);
    ear.position.set(0.26 + side * 0.2, 1.25, -0.13);
    ear.scale.set(0.68, 1.7, 0.62);
    ear.rotation.z = side * -0.23;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: '#342d28' }));
    eye.position.set(0.63, 0.91, side * 0.19 - 0.17);
    group.add(eye);
  }
  const tail = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 12),
    new THREE.MeshStandardMaterial({ color: '#f0dfc3', flatShading: true })
  );
  tail.position.set(-0.58, 0.7, 0.1);
  group.add(tail);
  scene.add(group);
  critters.push({ group, home: new THREE.Vector3(x, 0, z), phase });
}

function createWorld(): void {
  const hemisphere = new THREE.HemisphereLight('#dce8ff', '#4f6040', 1.45);
  scene.add(hemisphere);
  scene.add(new THREE.AmbientLight('#f7e8d0', 0.42));
  const sun = new THREE.DirectionalLight('#fff0d9', 3.1);
  sun.position.set(-18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.00012;
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

function createDynamicPhysicsProps(): void {
  const material = makeRockMaterial();
  const props = [
    { x: -2.8, z: 7.2, radius: 0.46 },
    { x: 2.8, z: 8.2, radius: 0.56 },
    { x: 4.8, z: 4.1, radius: 0.42 },
    { x: -11.4, z: 8.8, radius: 0.5 }
  ];
  for (const item of props) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(item.radius, 28, 20), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const body = physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(
        item.x,
        terrainHeight(item.x, item.z) + item.radius + 0.42,
        item.z
      )
    );
    physicsWorld.createCollider(
      RAPIER.ColliderDesc.ball(item.radius).setDensity(2.1).setFriction(0.92).setRestitution(0.08),
      body
    );
    dynamicProps.push({ body, mesh });
  }
}

async function createPhysics(): Promise<void> {
  await RAPIER.init();
  physicsWorld = new RAPIER.World({ x: 0, y: -22, z: 0 });
  physicsWorld.timestep = PHYSICS_STEP;

  if (!terrainGeometry || !terrainGeometry.index) {
    throw new Error('The terrain collision mesh is missing.');
  }
  const vertices = new Float32Array(terrainGeometry.attributes.position.array);
  const indices = Uint32Array.from(terrainGeometry.index.array as ArrayLike<number>);
  physicsWorld.createCollider(
    RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(1.05).setRestitution(0)
  );

  for (const tree of treeObstacles) {
    physicsWorld.createCollider(
      RAPIER.ColliderDesc.cylinder(tree.height * 0.5, tree.radius)
        .setTranslation(tree.x, terrainHeight(tree.x, tree.z) + tree.height * 0.5, tree.z)
        .setFriction(0.9)
    );
  }
  for (const box of boxObstacles) {
    physicsWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz)
        .setTranslation(box.x, box.y, box.z)
        .setFriction(0.8)
    );
  }
  for (const rock of rockObstacles) {
    physicsWorld.createCollider(
      RAPIER.ColliderDesc.ball(rock.radius)
        .setTranslation(rock.x, terrainHeight(rock.x, rock.z) + rock.radius * 0.48, rock.z)
        .setFriction(0.95)
    );
  }

  const start = player.position;
  playerBody = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      start.x,
      terrainHeight(start.x, start.z) + PLAYER_CAPSULE_CENTER + 0.04,
      start.z
    )
  );
  playerCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.capsule(0.72, 0.36).setFriction(0).setRestitution(0),
    playerBody
  );

  characterController = physicsWorld.createCharacterController(0.035);
  characterController.setUp({ x: 0, y: 1, z: 0 });
  characterController.setMaxSlopeClimbAngle(48 * Math.PI / 180);
  characterController.setMinSlopeSlideAngle(34 * Math.PI / 180);
  characterController.enableAutostep(0.34, 0.18, true);
  characterController.enableSnapToGround(0.3);
  characterController.setApplyImpulsesToDynamicBodies(true);

  createDynamicPhysicsProps();
  physicsWorld.step();
}

function stepPhysics(delta: number): void {
  if (!physicsWorld || !characterController || !playerBody || !playerCollider) return;
  physicsAccumulator += Math.min(delta, 0.05);
  let steps = 0;
  while (physicsAccumulator >= PHYSICS_STEP && steps < 3) {
    if (jumpRequested && isGrounded) {
      verticalVelocity = 8.2;
      isGrounded = false;
    }
    verticalVelocity = Math.max(-26, verticalVelocity - 22 * PHYSICS_STEP);
    const current = playerBody.translation();
    characterController.computeColliderMovement(playerCollider, {
      x: playerVelocity.x * PHYSICS_STEP,
      y: verticalVelocity * PHYSICS_STEP,
      z: playerVelocity.z * PHYSICS_STEP
    });
    const corrected = characterController.computedMovement();
    playerBody.setNextKinematicTranslation({
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z
    });
    physicsWorld.step();
    isGrounded = characterController.computedGrounded();
    if (isGrounded && verticalVelocity < 0) verticalVelocity = -1.35;

    const position = playerBody.translation();
    player.position.set(position.x, position.y - PLAYER_CAPSULE_CENTER, position.z);
    for (const item of dynamicProps) {
      const bodyPosition = item.body.translation();
      const rotation = item.body.rotation();
      item.mesh.position.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
      item.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
    physicsAccumulator -= PHYSICS_STEP;
    steps++;
  }
  jumpRequested = false;
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
ui.jump?.addEventListener('click', () => { if (isGrounded) jumpRequested = true; });
ui.run?.addEventListener('pointerdown', (event) => { event.preventDefault(); isRunning = true; });
const releaseRun = (): void => { isRunning = false; };
ui.run?.addEventListener('pointerup', releaseRun);
ui.run?.addEventListener('pointercancel', releaseRun);
ui.run?.addEventListener('pointerleave', releaseRun);

const keys = new Set<string>();
window.addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase());
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(event.key.toLowerCase())) event.preventDefault();
  if (event.key.toLowerCase() === 'e') interact();
  if (event.key.toLowerCase() === ' ') { event.preventDefault(); if (isGrounded) jumpRequested = true; }
  if (event.key.toLowerCase() === 'escape') saveGame();
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); isRunning = false; });

function setWalkTargetFromScreen(clientX: number, clientY: number): void {
  if (!terrainMesh) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrainMesh, false)[0];
  if (!hit) return;
  if (Math.hypot(hit.point.x - player.position.x, hit.point.z - player.position.z) > 0.8) {
    targetPosition = new THREE.Vector3(
      THREE.MathUtils.clamp(hit.point.x, -LIMIT, LIMIT),
      0,
      THREE.MathUtils.clamp(hit.point.z, -LIMIT, LIMIT)
    );
  }
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  renderer.domElement.setPointerCapture(event.pointerId);
  if (activePointers.size === 2) {
    const points = [...activePointers.values()];
    pinchStartDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    pinchStartZoom = cameraDistance;
    cameraPointerId = null;
    return;
  }
  if (event.clientX >= window.innerWidth * 0.38) {
    cameraPointerId = event.pointerId;
    cameraLastX = event.clientX;
    cameraLastY = event.clientY;
    cameraDragDistance = 0;
    cameraPointerStartedAt = performance.now();
  } else {
    cameraPointerId = null;
    setWalkTargetFromScreen(event.clientX, event.clientY);
  }
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size >= 2) {
    const points = [...activePointers.values()];
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    if (pinchStartDistance > 0) {
      cameraDistance = THREE.MathUtils.clamp(pinchStartZoom * pinchStartDistance / Math.max(1, distance), 8.5, 25);
    }
    return;
  }
  if (event.pointerId !== cameraPointerId) return;
  const dx = event.clientX - cameraLastX;
  const dy = event.clientY - cameraLastY;
  cameraDragDistance += Math.abs(dx) + Math.abs(dy);
  cameraYaw -= dx * 0.006;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.004, 0.18, 1.02);
  cameraLastX = event.clientX;
  cameraLastY = event.clientY;
});

const finishPointer = (event: PointerEvent): void => {
  if (event.pointerId === cameraPointerId && cameraDragDistance < 12 && performance.now() - cameraPointerStartedAt < 280) {
    setWalkTargetFromScreen(event.clientX, event.clientY);
  }
  activePointers.delete(event.pointerId);
  if (event.pointerId === cameraPointerId) cameraPointerId = null;
  if (activePointers.size < 2) pinchStartDistance = 0;
};
renderer.domElement.addEventListener('pointerup', finishPointer);
renderer.domElement.addEventListener('pointercancel', finishPointer);
renderer.domElement.addEventListener('wheel', (event) => {
  cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.012, 8.5, 25);
}, { passive: true });

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
