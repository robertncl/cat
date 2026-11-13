import * as THREE from 'three';
import { prim, primDistance, buildField, surfaceNets, noise3 } from './sdf.js';
import { FUR_SHELLS, createFurMaterial, createSkinMaterial, createEyeMaterial } from './fur.js';

// ---------- Fur presets ----------
// Only `body` is required. Unset areas keep the body colour (and its markings).

const fur = (id, name, o) => ({ earInner: '#e8a9a9', nose: '#d98b8b', eyes: '#8fbf4d', ...o, id, name });

export const FURS = [
  fur('ginger', 'Ginger tabby', { body: '#d98a3d', belly: '#f7e6cd', paws: '#f7e6cd', tailTip: '#f7e6cd', stripes: '#a9581b', eyes: '#7fae3f' }),
  fur('black', 'Black', { body: '#2a2a30', eyes: '#f0c330', nose: '#3a3038', earInner: '#4a3d44' }),
  fur('white', 'White', { body: '#f5f2ec', eyes: '#5aa9e6', nose: '#eaa0a8' }),
  fur('grey', 'Russian blue', { body: '#7d8898', belly: '#8d98a8', eyes: '#6fbf73', nose: '#5c6370', earInner: '#b99aa0' }),
  fur('tuxedo', 'Tuxedo', { body: '#26262b', belly: '#f5f2ec', paws: '#f5f2ec', tailTip: '#f5f2ec', eyes: '#d9c13a', bib: true }),
  fur('siamese', 'Siamese', { body: '#ecdcc6', belly: '#f4eadb', muzzle: '#5a4032', legs: '#5a4032', ears: '#5a4032', tail: '#5a4032', eyes: '#4f9be8', nose: '#3a2a22', earInner: '#7a5a4c', mask: true }),
  fur('calico', 'Calico', { body: '#f5f0e8', belly: '#f5f0e8', patches: ['#d98a3d', '#2e2a2a'], ears: ['#d98a3d', '#2e2a2a'], tail: '#2e2a2a', tailTip: '#d98a3d', eyes: '#b9a23a' }),
  fur('brown', 'Brown tabby', { body: '#8f7152', belly: '#dcc7a8', paws: '#dcc7a8', stripes: '#49341f', eyes: '#9ab83c', nose: '#b06a5a' }),
];

// ---------- Anatomy (rest pose: standing, facing +Z, floor at y = 0) ----------

export const TAIL_SEGMENTS = 8;
const CELL = 0.009; // meshing resolution
const MIN_SHELLS = 14; // fewest fur layers, for when the cat is small on screen
const S = 0.088; // legs sit this far either side of the centre line

const HEAD_SCALE = 1.1;
const HEAD = [0, 0.6, 0.385];
const onHeadScale = (p) => p.map((v, i) => HEAD[i] + (v - HEAD[i]) * HEAD_SCALE); // the head is modelled at 1:1, then enlarged

const J = {
  hips: [0, 0.455, -0.27], spine: [0, 0.465, -0.09], chest: [0, 0.455, 0.1],
  neck: [0, 0.48, 0.265], head: HEAD, snout: onHeadScale([0, 0.58, 0.5]),
  ear: onHeadScale([0.058, 0.665, 0.385]), earTip: onHeadScale([0.088, 0.772, 0.372]),
  shoulder: [S, 0.385, 0.22], elbow: [S, 0.25, 0.13], wrist: [S, 0.065, 0.14], foreToe: [S, 0.03, 0.19],
  hip: [S, 0.4, -0.25], knee: [S, 0.26, -0.13], hock: [S, 0.14, -0.31], hindToe: [S, 0.038, -0.265],
  tail: [0, 0.455, -0.39], tailEnd: [0, 0.465, -1.03],
  eye: onHeadScale([0.045, 0.603, 0.461]), nose: onHeadScale([0, 0.578, 0.531]), muzzle: onHeadScale([0, 0.56, 0.495]),
};
const FORE_HOME = [S, 0, 0.165]; // where a paw touches the floor
const HIND_HOME = [S, 0, -0.262];
const EYE_R = 0.0245 * HEAD_SCALE;

const TAGS = ['torso', 'chest', 'neck', 'head', 'cheek', 'muzzle', 'ear', 'foreUp', 'foreLow', 'hindUp', 'hindLow', 'paw', 'tail'];
const T = Object.fromEntries(TAGS.map((t, i) => [t, i]));
const FUR_LENGTH = { torso: 1, chest: 1.2, neck: 1.1, head: 0.55, cheek: 0.85, muzzle: 0.28, ear: 0.2, foreUp: 0.75, foreLow: 0.42, hindUp: 0.9, hindLow: 0.42, paw: 0.3, tail: 1.3 };

const mirrorX = ([x, y, z]) => [-x, y, z];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The body as soft-blended blobs. Anything off the centre line is mirrored. */
function shape() {
  const out = [];
  const add = (o) => {
    out.push(prim(o));
    if (o.a[0] !== 0) out.push(prim({ ...o, a: mirrorX(o.a), b: mirrorX(o.b ?? o.a) }));
  };
  const addHead = (o) => add({
    ...o, a: onHeadScale(o.a), b: o.b && onHeadScale(o.b), ra: o.ra * HEAD_SCALE, rb: o.rb && o.rb * HEAD_SCALE, k: o.k * HEAD_SCALE,
  });
  const narrow = [0.84, 1, 1];

  add({ tag: 'torso', a: [0, 0.425, -0.27], b: [0, 0.412, 0.1], ra: 0.118, rb: 0.125, k: 0.04, squash: narrow });
  add({ tag: 'torso', a: [0, 0.42, -0.31], ra: 0.112, k: 0.04, squash: [0.85, 1, 0.9] });
  add({ tag: 'chest', a: [0, 0.4, 0.15], ra: 0.136, k: 0.04, squash: [0.74, 1, 0.88] });
  add({ tag: 'torso', a: [0.052, 0.455, 0.14], ra: 0.06, k: 0.04 });
  add({ tag: 'neck', a: [0, 0.45, 0.19], b: [0, 0.575, 0.36], ra: 0.09, rb: 0.07, k: 0.04 });

  addHead({ tag: 'head', a: [0, 0.605, 0.395], ra: 0.098, k: 0.03, squash: [1, 0.9, 0.97] });
  addHead({ tag: 'cheek', a: [0.048, 0.572, 0.432], ra: 0.05, k: 0.025 });
  addHead({ tag: 'head', a: [0, 0.605, 0.45], b: [0, 0.584, 0.512], ra: 0.034, rb: 0.021, k: 0.02 });
  addHead({ tag: 'muzzle', a: [0.02, 0.562, 0.49], ra: 0.03, k: 0.018 });
  addHead({ tag: 'muzzle', a: [0, 0.542, 0.478], ra: 0.026, k: 0.018 });
  add({ tag: 'ear', a: J.ear, b: J.earTip, ra: 0.05, rb: 0.013, k: 0.012, squash: [1, 1, 0.36] });

  add({ tag: 'foreUp', a: [S - 0.014, J.shoulder[1], J.shoulder[2] - 0.01], b: J.elbow, ra: 0.054, rb: 0.046, k: 0.03, squash: [0.85, 1, 1] });
  add({ tag: 'foreLow', a: J.elbow, b: J.wrist, ra: 0.042, rb: 0.033, k: 0.02 });
  add({ tag: 'paw', a: [S, 0.034, FORE_HOME[2] + 0.008], ra: 0.052, k: 0.015, squash: [0.7, 0.62, 1] });

  add({ tag: 'hindUp', a: J.hip, b: J.knee, ra: 0.09, rb: 0.054, k: 0.035, squash: [0.72, 1, 1] });
  add({ tag: 'hindLow', a: J.knee, b: J.hock, ra: 0.047, rb: 0.03, k: 0.02 });
  add({ tag: 'hindLow', a: J.hock, b: J.hindToe, ra: 0.029, rb: 0.03, k: 0.015 });
  add({ tag: 'paw', a: [S, 0.032, HIND_HOME[2] + 0.012], ra: 0.05, k: 0.015, squash: [0.7, 0.6, 1] });

  add({ tag: 'tail', a: [0, 0.455, -0.36], b: J.tailEnd, ra: 0.036, rb: 0.024, k: 0.03 });

  add({ tag: 'head', a: J.eye, ra: EYE_R - 0.0005, k: 0.006, carve: true }); // eye sockets
  return out;
}

// ---------- Coat colours ----------

function palette(f) {
  const col = (v) => (v ? new THREE.Color(v) : null);
  const pair = (v) => (Array.isArray(v) ? v.map(col) : [col(v), col(v)]);
  const muzzle = f.muzzle ?? f.belly;
  return {
    body: col(f.body), belly: col(f.belly), muzzle: col(muzzle), legs: col(f.legs), paws: col(f.paws ?? f.legs),
    ears: pair(f.ears), earInner: col(f.earInner), tail: col(f.tail), tailTip: col(f.tailTip ?? f.tail),
    stripes: col(f.stripes), patches: f.patches ? f.patches.map(col) : null, bib: !!f.bib, mask: !!f.mask,
  };
}

function stripeAmount(x, y, z, ny, tag) {
  const wobble = noise3(x * 9, y * 9, z * 9) * 2.6;
  const band = (v) => ss(0.25, 0.6, Math.sin(v + wobble));
  const ax = Math.abs(x);
  switch (tag) {
    case T.torso: case T.chest: case T.neck: {
      const flank = band(z * 48 + ax * 10) * ss(-0.55, 0.05, ny);
      const spine = ss(0.032, 0.012, ax) * ss(0.4, 0.8, ny);
      return Math.max(flank, spine);
    }
    case T.hindUp: return band(y * 55 + z * 25);
    case T.foreUp: case T.foreLow: case T.hindLow: return band(y * 70);
    case T.tail: return band(z * 42);
    case T.head: case T.cheek: {
      const forehead = ss(0.2, 0.7, Math.sin(x * 150 + wobble * 0.4)) * ss(0.3, 0.7, ny) * ss(0.478, 0.424, z);
      const cheek = band(y * 110 - z * 60) * ss(0.05, 0.075, ax) * ss(0.62, 0.6, y);
      return Math.max(forehead, cheek);
    }
    default: return 0;
  }
}

const color = new THREE.Color();

/** Coat colour at a point on the resting body. Writes into (and returns) a shared Color. */
function coatColor(c, x, y, z, ny, nz, tag) {
  color.copy(c.body);
  const leg = tag === T.foreUp || tag === T.foreLow || tag === T.hindUp || tag === T.hindLow || tag === T.paw;
  const trunk = tag === T.torso || tag === T.chest || tag === T.neck;

  if (c.patches) {
    color.lerp(c.patches[0], ss(0.5, 0.54, noise3(x * 5 + 11, y * 5 + 3, z * 5 + 7)));
    color.lerp(c.patches[1], ss(0.55, 0.59, noise3(x * 5.5 + 31, y * 5.5 + 17, z * 5.5 + 23)));
  }
  if (leg && c.legs) color.lerp(c.legs, ss(0.37, 0.2, y));
  if (tag === T.tail && c.tail) color.lerp(c.tail, ss(-0.4, -0.5, z));
  if (tag === T.ear && c.ears[0]) color.copy(c.ears[x < 0 ? 0 : 1]);
  if (c.stripes) color.lerp(c.stripes, 0.85 * stripeAmount(x, y, z, ny, tag));

  if (c.belly) {
    let under = 0;
    if (trunk || tag === T.hindUp) under = ss(-0.2, -0.7, ny);
    if (trunk && c.bib) under = Math.max(under, ss(0.1, 0.5, nz) * ss(0.56, 0.48, y) * ss(0.02, 0.14, z));
    if (tag === T.cheek && c.bib) under = Math.max(under, ss(0.572, 0.55, y));
    color.lerp(c.belly, under);
  }
  if (leg && c.paws) color.lerp(c.paws, ss(0.115, 0.075, y));
  if (tag === T.tail && c.tailTip) color.lerp(c.tailTip, ss(-0.88, -0.93, z));
  if (c.muzzle) {
    const d = Math.hypot(x, y - J.muzzle[1], z - J.muzzle[2]);
    color.lerp(c.muzzle, c.mask ? ss(0.125, 0.065, d) : ss(0.077, 0.05, d));
  }
  if (tag === T.ear) {
    // Pink skin shows through the thin fur in the hollow of the ear.
    const up = (y - J.ear[1]) / (J.earTip[1] - J.ear[1]);
    const axis = J.ear[0] + (J.earTip[0] - J.ear[0]) * up;
    color.lerp(c.earInner, 0.8 * ss(0.2, 0.6, nz) * ss(0.026, 0.008, Math.abs(Math.abs(x) - axis) + up * 0.016));
  }
  return color;
}

// ---------- Model ----------

export function createCat() {
  const root = new THREE.Group();

  // --- Skeleton. Every bone is unrotated at rest, so a bone's local axes match the cat's. ---
  const bones = [];
  const skin = []; // { bone index, a, b, r }: the stretch of body each bone carries
  const bone = (parent, at, parentAt, seg) => {
    const b = new THREE.Bone();
    b.position.set(...sub(at, parentAt));
    parent.add(b);
    bones.push(b);
    if (seg) skin.push({ bone: bones.length - 1, ...seg });
    return b;
  };

  const hips = bone(root, J.hips, [0, 0, 0], { a: [0, 0.425, -0.4], b: [0, 0.425, -0.09], r: 0.125 });
  const spine = bone(hips, J.spine, J.hips, { a: [0, 0.425, -0.09], b: [0, 0.42, 0.1], r: 0.125 });
  const chest = bone(spine, J.chest, J.spine, { a: [0, 0.42, 0.1], b: [0, 0.42, 0.24], r: 0.13 });
  const neck = bone(chest, J.neck, J.chest, { a: [0, 0.47, 0.25], b: [0, 0.58, 0.37], r: 0.085 });
  const head = bone(neck, J.head, J.neck, { a: J.head, b: J.snout, r: 0.095 });
  neck.rotation.order = head.rotation.order = 'YXZ';

  const side = (p, s) => [p[0] * s, p[1], p[2]];
  const ears = [-1, 1].map((s) => bone(head, side(J.ear, s), J.head, { a: side(J.ear, s), b: side(J.earTip, s), r: 0.02 }));

  const tail = [];
  {
    let parent = hips;
    let from = J.hips;
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const at = (k) => [0, 1, 2].map((n) => J.tail[n] + (J.tailEnd[n] - J.tail[n]) * (k / TAIL_SEGMENTS));
      parent = bone(parent, at(i), from, { a: at(i), b: at(i + 1), r: 0.04 });
      from = at(i);
      tail.push(parent);
    }
  }

  // Legs: FL, FR, HL, HR. Each is a three-bone chain: upper, lower, paw.
  const legs = [];
  for (const front of [true, false]) {
    for (const s of [-1, 1]) {
      const [top, mid, low, toe] = (front ? [J.shoulder, J.elbow, J.wrist, J.foreToe] : [J.hip, J.knee, J.hock, J.hindToe]).map((p) => side(p, s));
      const parent = front ? chest : hips;
      const upper = bone(parent, top, front ? J.chest : J.hips, { a: top, b: mid, r: front ? 0.05 : 0.065 });
      const lower = bone(upper, mid, top, { a: mid, b: low, r: front ? 0.035 : 0.04 });
      const paw = bone(lower, low, mid, { a: low, b: toe, r: 0.035 });
      upper.rotation.order = 'ZYX'; // swing in the leg's plane first, then splay sideways
      const home = side(front ? FORE_HOME : HIND_HOME, s);
      const a = sub(mid, top);
      const b = sub(low, mid);
      legs.push({
        upper, lower, paw, front, side: s,
        home: new THREE.Vector3(...home),
        ankle: new THREE.Vector3(...sub(low, home)), // from the floor contact up to the wrist / hock
        restZ: upper.position.z,
        len1: Math.hypot(a[1], a[2]), len2: Math.hypot(b[1], b[2]),
        rest1: Math.atan2(a[2], -a[1]), rest2: Math.atan2(b[2], -b[1]), // angles forward of straight-down
        bend: front ? -1 : 1, // elbows point back, knees point forward
      });
    }
  }

  // --- Skin mesh ---
  const prims = shape();
  const solid = prims.filter((p) => !p.carve);
  const { positions, indices } = surfaceNets(buildField(prims, [-22 * CELL, -3 * CELL, -120 * CELL], [22 * CELL, 93 * CELL, 63 * CELL], CELL));
  const count = positions.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal.array;

  const tags = new Uint8Array(count);
  const furLen = new Float32Array(count);
  const furDir = new Float32Array(count * 3);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const weights = new Float32Array(bones.length);
  const skinPrims = skin.map((s) => prim({ a: s.a, b: s.b, ra: 0 }));

  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];

    // Which body part is this?
    let best = Infinity;
    for (const p of solid) {
      const d = primDistance(p, x, y, z);
      if (d < best) { best = d; tags[i] = T[p.tag]; }
    }
    const tag = tags[i];

    // Fur gets shorter on the face and paws, and vanishes around the eyes and nose.
    const eye = Math.hypot(Math.abs(x) - J.eye[0], y - J.eye[1], z - J.eye[2]);
    const nose = Math.hypot(x, y - J.nose[1], z - J.nose[2]);
    furLen[i] = FUR_LENGTH[TAGS[tag]] * ss(0.027, 0.06, eye) * ss(0.012, 0.035, nose);

    // Combing direction: toward the tail on the body, down the legs — flattened onto the skin.
    const limb = tag === T.foreUp || tag === T.foreLow || tag === T.hindUp || tag === T.hindLow || tag === T.paw;
    const gx = 0;
    const gy = limb ? -1 : tag === T.ear ? 0.8 : -0.3;
    const gz = limb ? -0.25 : -1;
    const dot = gx * nx + gy * ny + gz * nz;
    furDir[i * 3] = gx - nx * dot;
    furDir[i * 3 + 1] = gy - ny * dot;
    furDir[i * 3 + 2] = gz - nz * dot;

    // Skin weights: each bone pulls in proportion to how close its stretch of body is.
    weights.fill(0);
    skin.forEach((s, k) => {
      const d = Math.max(primDistance(skinPrims[k], x, y, z), 1e-3) / s.r;
      weights[s.bone] = Math.max(weights[s.bone], 1 / d ** 6);
    });
    let total = 0;
    for (let k = 0; k < 4; k++) {
      let top = 0;
      for (let b = 1; b < weights.length; b++) if (weights[b] > weights[top]) top = b;
      skinIndex[i * 4 + k] = top;
      skinWeight[i * 4 + k] = weights[top];
      total += weights[top];
      weights[top] = 0;
    }
    for (let k = 0; k < 4; k++) skinWeight[i * 4 + k] /= total;
  }
  const colors = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  geometry.setAttribute('color', colors);
  geometry.setAttribute('furLen', new THREE.BufferAttribute(furLen, 1));
  geometry.setAttribute('furDir', new THREE.BufferAttribute(furDir, 3));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

  // The fur shells reuse the skin's buffers; instancing draws all the layers in one call.
  const shells = new THREE.InstancedBufferGeometry();
  shells.setIndex(geometry.index);
  for (const [name, attribute] of Object.entries(geometry.attributes)) shells.setAttribute(name, attribute);
  shells.instanceCount = FUR_SHELLS;

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const furMaterial = createFurMaterial();
  const skinMesh = new THREE.SkinnedMesh(geometry, createSkinMaterial());
  const furMesh = new THREE.SkinnedMesh(shells, furMaterial);
  skinMesh.castShadow = true;
  for (const m of [skinMesh, furMesh]) {
    m.receiveShadow = true;
    m.frustumCulled = false; // the rest-pose bounds mean nothing once the cat moves
    root.add(m);
    m.bind(skeleton);
  }

  // --- Face ---
  const mats = {
    eye: createEyeMaterial(),
    lid: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    nose: new THREE.MeshStandardMaterial({ roughness: 0.45 }),
    mouth: new THREE.MeshStandardMaterial({ color: '#5a2630', roughness: 0.8 }),
    whisker: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }),
  };
  const onHead = (obj, at) => {
    obj.position.set(...sub(at, J.head));
    head.add(obj);
    return obj;
  };

  const lids = [-1, 1].map((s) => {
    const eye = onHead(new THREE.Group(), side(J.eye, s));
    eye.rotation.set(-0.06, s * 0.3, 0);
    eye.add(new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 32, 24), mats.eye));
    // The lid is a half-dome that tips forward over the eye.
    const lid = new THREE.Mesh(new THREE.SphereGeometry(EYE_R * 1.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.lid);
    eye.add(lid);
    return lid;
  });

  const nose = onHead(new THREE.Mesh(new THREE.SphereGeometry(0.0115, 16, 12), mats.nose), J.nose);
  nose.scale.set(1.3, 0.85, 0.7);
  const mouth = onHead(new THREE.Mesh(new THREE.SphereGeometry(0.021, 16, 12), mats.mouth), onHeadScale([0, 0.549, 0.502]));

  const whiskerGeo = new THREE.CylinderGeometry(0.0012, 0.0003, 0.15, 4).translate(0, 0.075, 0);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const w = onHead(new THREE.Mesh(whiskerGeo, mats.whisker), onHeadScale([s * 0.036, 0.556 + k * 0.006, 0.508]));
      w.rotation.set(0, -s * (0.1 + k * 0.1), -s * (Math.PI / 2 + 0.3 - k * 0.2));
    }
    for (let k = 0; k < 2; k++) {
      const w = onHead(new THREE.Mesh(whiskerGeo, mats.whisker), onHeadScale([s * (0.04 + k * 0.012), 0.636, 0.462]));
      w.scale.setScalar(0.4);
      w.rotation.set(0.9, 0, -s * (0.5 + k * 0.3));
    }
  }

  // --- Spheres used to rest the cat on the floor and to tell when it is being petted ---
  const probes = [];
  const probe = (owner, ownerAt, at, r, leg = -1, rests = true) => {
    probes.push({ bone: owner, offset: new THREE.Vector3(...sub(at, ownerAt)), r, leg, rests });
  };
  probe(hips, J.hips, [0, 0.42, -0.3], 0.115);
  probe(spine, J.spine, [0, 0.42, -0.09], 0.118);
  probe(chest, J.chest, [0, 0.405, 0.13], 0.13);
  probe(head, J.head, [0, 0.6, 0.425], 0.105, -1, false);
  legs.forEach((leg, i) => {
    const [mid, low] = (leg.front ? [J.elbow, J.wrist] : [J.knee, J.hock]).map((p) => side(p, leg.side));
    probe(leg.lower, mid, mid, leg.front ? 0.04 : 0.046, i);
    probe(leg.paw, low, low, 0.028, i);
    probe(leg.paw, low, [leg.home.x, 0.03, leg.home.z], 0.03, i);
  });

  const sphere = new THREE.Sphere();
  /** Does this world-space ray touch the cat? */
  function hit(ray) {
    root.updateMatrixWorld(true);
    return probes.some((p) => {
      if (p.leg >= 0) return false;
      p.bone.localToWorld(sphere.center.copy(p.offset));
      sphere.radius = p.r * 1.25;
      return ray.intersectsSphere(sphere);
    });
  }

  function setFur(f) {
    const c = palette(f);
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      coatColor(c, positions[o], positions[o + 1], positions[o + 2], normals[o + 1], normals[o + 2], tags[i]);
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    mats.lid.color.copy(coatColor(c, J.eye[0], J.eye[1] + 0.02, J.eye[2], 0.5, 0.8, T.head)).multiplyScalar(0.55);
    mats.nose.color.set(f.nose);
    mats.eye.userData.uniforms.uIris.value.set(f.eyes);
  }
  setFur(FURS[0]);

  /**
   * Draw only as many fur shells as the screen can tell apart: about three for every two pixels
   * of fur length. `pixelsPerMetre` is the cat's scale on screen.
   */
  function setFurDetail(pixelsPerMetre) {
    const uniforms = furMaterial.userData.uniforms;
    const wanted = Math.min(FUR_SHELLS, Math.max(MIN_SHELLS, uniforms.uFurLength.value * pixelsPerMetre * 1.6));
    if (Math.abs(wanted - shells.instanceCount) < 2) return; // ignore small changes, so the count does not flicker
    shells.instanceCount = uniforms.uShells.value = Math.round(wanted);
  }

  return {
    root, hips, spine, chest, neck, head, ears, tail, legs, lids, mouth, probes, hit, setFur, setFurDetail,
    rest: { hips: hips.position.clone(), mouth: mouth.position.clone() },
    eye: mats.eye.userData.uniforms,
    fur: furMaterial.userData.uniforms,
  };
}
