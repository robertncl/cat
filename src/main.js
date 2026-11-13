import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';
import { createCat, FURS } from './cat.js';
import { CatController, ACTIONS } from './behavior.js';
import { CatAudio } from './audio.js';

const canvas = document.getElementById('scene');
const BG = '#f3e9dc';
const ROOM_RADIUS = 9; // how far from the centre the cat may wander

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 16, 30);

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
const CAMERA_OFFSET = new THREE.Vector3(0, 2.0, 4.6); // from the point the camera watches
const focus = new THREE.Vector3(0, 0.3, 0);

// Soft room light for the fur and the reflections in the eyes, plus a sun for shadows.
const room = new RoomEnvironment();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight('#fff6ea', '#b9a58c', 0.7));
const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
const SUN_OFFSET = new THREE.Vector3(5, 10, 6); // from the cat, which the sun follows
sun.castShadow = true;
// The shadow map covers just the cat, the only thing casting one. Floor outside it skips the
// soft-shadow lookups, which otherwise cost more than anything else drawn on the floor.
sun.shadow.mapSize.set(512, 512);
Object.assign(sun.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 1, far: 30 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const flat = (geo, color, y) => {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  scene.add(m);
  return m;
};
flat(new THREE.RingGeometry(5, 40, 64), '#d8c4a4', 0.004); // a ring level with the rug, so the floor under it is not shaded twice
flat(new THREE.CircleGeometry(5, 64), '#8fb0aa', 0.004);
flat(new THREE.RingGeometry(4.3, 4.55, 64), '#f1e6d2', 0.008);

// Laser-pointer dot marking where the cat is being led
const dot = new THREE.Mesh(
  new THREE.CircleGeometry(0.07, 24),
  new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.9 }),
);
dot.rotation.x = -Math.PI / 2;
dot.position.y = 0.015;
scene.add(dot);

// ---------- Cat ----------
const cat = createCat();
scene.add(cat.root);

// The fur is lit by the same room, boiled down to spherical harmonics (see fur.js).
{
  const cube = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace });
  new THREE.CubeCamera(0.1, 100, cube).update(renderer, room);
  const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, cube);
  cat.fur.uRoomLight.value = probe.sh.scale(scene.environmentIntensity).coefficients;
  cube.dispose();
}

const audio = new CatAudio();
const controller = new CatController(cat, audio);

// ---------- UI ----------
const statusEl = document.getElementById('status');
const actionButtons = {};
controller.onStatus = (text, name) => {
  statusEl.textContent = text;
  for (const [key, btn] of Object.entries(actionButtons)) btn.classList.toggle('active', key === name);
};

const actionsEl = document.getElementById('actions');
for (const [name, def] of Object.entries(ACTIONS)) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.append(def.label);
  const kbd = document.createElement('kbd');
  kbd.textContent = def.key.toUpperCase();
  btn.append(kbd);
  btn.addEventListener('click', () => trigger(name));
  actionsEl.append(btn);
  actionButtons[name] = btn;
}

function trigger(name) {
  audio.unlock();
  controller.do(name);
}

const furNameEl = document.getElementById('fur-name');
const fursEl = document.getElementById('furs');
const swatches = FURS.map((fur) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'swatch';
  btn.title = fur.name;
  btn.setAttribute('aria-label', fur.name);
  const second = fur.patches ? '#2e2a2a' : fur.stripes ?? (fur.legs !== fur.body ? fur.legs : fur.belly);
  const third = fur.patches ? '#d98a3d' : fur.body;
  btn.style.background = `conic-gradient(${fur.body} 0 50%, ${second} 50% 75%, ${third} 75%)`;
  btn.addEventListener('click', () => selectFur(fur.id));
  fursEl.append(btn);
  return btn;
});

function selectFur(id) {
  const index = Math.max(0, FURS.findIndex((f) => f.id === id));
  cat.setFur(FURS[index]);
  furNameEl.textContent = FURS[index].name;
  swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
  try { localStorage.setItem('cat-fur', FURS[index].id); } catch { /* storage unavailable */ }
}
let savedFur = null;
try { savedFur = localStorage.getItem('cat-fur'); } catch { /* storage unavailable */ }
selectFur(savedFur);

const toggle = (id, onChange) => {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    onChange(on);
  });
};
toggle('follow', (on) => { controller.follow = on; });
toggle('sound', (on) => { audio.muted = !on; audio.unlock(); });

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.key === ' ' && e.target === document.body) {
    e.preventDefault();
    controller.call();
    return;
  }
  const hit = Object.entries(ACTIONS).find(([, def]) => def.key === e.key.toLowerCase());
  if (hit) trigger(hit[0]);
});

// ---------- Pointer ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointerSeen = false;
const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();

function aim(e) {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

function updateTarget(e) {
  if (e) {
    aim(e);
    pointerSeen = true;
  } else {
    raycaster.setFromCamera(ndc, camera); // the camera moved under a resting pointer
  }
  if (!raycaster.ray.intersectPlane(floor, hitPoint)) return;
  const d = Math.hypot(hitPoint.x, hitPoint.z);
  if (d > ROOM_RADIUS) hitPoint.multiplyScalar(ROOM_RADIUS / d);
  controller.target.copy(hitPoint);
  dot.position.set(hitPoint.x, 0.015, hitPoint.z);
}

canvas.addEventListener('pointermove', updateTarget);
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  aim(e);
  if (cat.hit(raycaster.ray)) {
    controller.do('purr'); // petting
    for (let i = 0; i < 3; i++) setTimeout(() => heart(e.clientX + (Math.random() - 0.5) * 50, e.clientY), i * 160);
  } else {
    updateTarget(e);
    controller.call();
  }
});

function heart(x, y) {
  const el = document.createElement('span');
  el.className = 'heart';
  el.textContent = '💗';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.addEventListener('animationend', () => el.remove());
  document.body.append(el);
}

// ---------- Loop ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 52 : 34; // widen the view on portrait screens
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  controller.update(dt, clock.elapsedTime);

  // The camera drifts after the cat so it stays close enough to see.
  tmp.copy(cat.root.position).multiplyScalar(0.5).setY(0.3);
  focus.lerp(tmp, 1 - Math.exp(-dt * 2));
  camera.position.copy(focus).add(CAMERA_OFFSET);
  camera.lookAt(focus);
  if (pointerSeen) updateTarget();

  // The sun's shadow map and the fur's level of detail both follow the cat.
  sun.target.position.setFromMatrixPosition(cat.spine.matrixWorld);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);
  const pixelsPerMetre = canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.distanceTo(sun.target.position));
  cat.setFurDetail(pixelsPerMetre);
  renderer.render(scene, camera);
});

// Handy for poking at the cat from the browser console.
window.cat = controller;
