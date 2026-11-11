import * as THREE from 'three';

// ---------- Fur presets ----------

const FUR_DEFAULTS = { earInner: '#e8a9a9', nose: '#d98b8b', eyes: '#8fbf4d', stripes: null, patches: false };

function fur(id, name, o) {
  const f = { ...FUR_DEFAULTS, ...o, id, name };
  f.belly ??= f.body;
  f.muzzle ??= f.belly;
  f.legs ??= f.body;
  f.paws ??= f.legs;
  f.ears ??= f.body;
  f.tail ??= f.body;
  f.tailTip ??= f.tail;
  return f;
}

export const FURS = [
  fur('ginger', 'Ginger tabby', { body: '#d98a3d', belly: '#f7e6cd', paws: '#f7e6cd', tailTip: '#f7e6cd', stripes: '#a9581b', eyes: '#7fae3f' }),
  fur('black', 'Black', { body: '#2a2a30', eyes: '#f0c330', nose: '#3a3038', earInner: '#4a3d44' }),
  fur('white', 'White', { body: '#f5f2ec', eyes: '#5aa9e6', nose: '#eaa0a8' }),
  fur('grey', 'Russian blue', { body: '#7d8898', belly: '#8d98a8', eyes: '#6fbf73', nose: '#5c6370', earInner: '#b99aa0' }),
  fur('tuxedo', 'Tuxedo', { body: '#26262b', belly: '#f5f2ec', paws: '#f5f2ec', tailTip: '#f5f2ec', eyes: '#d9c13a' }),
  fur('siamese', 'Siamese', { body: '#ecdcc6', belly: '#f4eadb', muzzle: '#5a4032', legs: '#5a4032', ears: '#5a4032', tail: '#5a4032', eyes: '#4f9be8', nose: '#3a2a22', earInner: '#7a5a4c' }),
  fur('calico', 'Calico', { body: '#f5f0e8', patches: true, ears: ['#d98a3d', '#2e2a2a'], tail: '#2e2a2a', tailTip: '#d98a3d', eyes: '#b9a23a' }),
  fur('brown', 'Brown tabby', { body: '#8f7152', belly: '#dcc7a8', paws: '#dcc7a8', stripes: '#49341f', eyes: '#9ab83c', nose: '#b06a5a' }),
];

// ---------- Model ----------
// The cat faces +Z. Leg/tail joints rotate about X: a negative angle swings a leg forward.

export const TAIL_SEGMENTS = 7;

export function createCat() {
  const furMat = () => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const mats = {
    body: furMat(), belly: furMat(), muzzle: furMat(), legs: furMat(), paws: furMat(),
    earL: furMat(), earR: furMat(), earInner: furMat(),
    tail: furMat(), tailRing: furMat(), tailTip: furMat(), stripe: furMat(),
    patchA: new THREE.MeshStandardMaterial({ color: '#d98a3d', roughness: 0.9 }),
    patchB: new THREE.MeshStandardMaterial({ color: '#2e2a2a', roughness: 0.9 }),
    nose: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
    iris: new THREE.MeshStandardMaterial({ roughness: 0.25 }),
    pupil: new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.2 }),
    mouth: new THREE.MeshStandardMaterial({ color: '#5a2630', roughness: 0.8 }),
    whisker: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }),
  };

  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const group = (parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const sphere = (r) => new THREE.SphereGeometry(r, 24, 18);

  const root = new THREE.Group();
  const body = group(root);
  const probes = []; // { obj, r } spheres used to keep the cat resting on the floor
  const probe = (parent, r, x = 0, y = 0, z = 0) => probes.push({ obj: group(parent, x, y, z), r });

  // Torso
  const torsoGeo = new THREE.CapsuleGeometry(0.2, 0.5, 8, 20).rotateX(Math.PI / 2);
  mesh(torsoGeo, mats.body, body);
  mesh(sphere(0.17), mats.belly, body, 0, -0.08, 0).scale.set(0.8, 0.8, 1.9);
  mesh(sphere(0.16), mats.belly, body, 0, -0.05, 0.33);
  mesh(sphere(0.215), mats.body, body, 0, 0, -0.24).scale.set(1.05, 1, 1);
  probe(body, 0.2, 0, 0, 0.3);
  probe(body, 0.215, 0, 0, 0);
  probe(body, 0.21, 0, 0, -0.3);

  // Tabby stripes over the back
  const stripes = group(body);
  const stripeGeo = new THREE.TorusGeometry(0.2, 0.017, 6, 20, Math.PI);
  for (const z of [-0.33, -0.19, -0.05, 0.09, 0.23]) {
    mesh(stripeGeo, mats.stripe, stripes, 0, 0, z).scale.set(1.03, 1.03, 1);
  }

  // Calico patches
  const patches = group(body);
  mesh(sphere(0.12), mats.patchA, patches, 0.08, 0.07, 0.2);
  mesh(sphere(0.13), mats.patchB, patches, -0.07, 0.08, -0.02);
  mesh(sphere(0.12), mats.patchA, patches, 0.06, 0.09, -0.3);
  mesh(sphere(0.1), mats.patchB, patches, -0.12, -0.02, 0.28);

  // Neck and head
  const headPivot = group(body, 0, 0.1, 0.36);
  const neck = mesh(new THREE.CapsuleGeometry(0.11, 0.12, 6, 14), mats.body, headPivot, 0, 0.07, 0.04);
  neck.rotation.x = 0.5;
  const head = group(headPivot, 0, 0.2, 0.12);
  head.rotation.order = 'YXZ';
  mesh(sphere(0.19), mats.body, head).scale.set(1.08, 0.92, 1);
  probe(head, 0.17);

  const headStripes = group(head);
  for (const x of [-0.05, 0, 0.05]) {
    const s = mesh(new THREE.CapsuleGeometry(0.011, 0.07, 4, 8), mats.stripe, headStripes, x, 0.155, 0.07);
    s.rotation.x = 1.1;
    s.rotation.z = -x * 4;
  }
  const headPatch = mesh(sphere(0.1), mats.patchA, head, 0.08, 0.09, 0.02);

  const earGeo = new THREE.ConeGeometry(0.075, 0.15, 16).scale(1, 1, 0.55);
  const earInnerGeo = new THREE.ConeGeometry(0.048, 0.11, 12).scale(1, 1, 0.4);
  const ears = [-1, 1].map((side) => {
    const ear = group(head, side * 0.11, 0.15, -0.01);
    ear.rotation.z = -side * 0.28;
    mesh(earGeo, side < 0 ? mats.earL : mats.earR, ear, 0, 0.06, 0);
    mesh(earInnerGeo, mats.earInner, ear, 0, 0.05, 0.022);
    return ear;
  });

  const eyes = [-1, 1].map((side) => {
    const eye = group(head, side * 0.078, 0.03, 0.152);
    eye.rotation.y = side * 0.3;
    mesh(sphere(0.046), mats.iris, eye).scale.set(1, 1, 0.5);
    mesh(sphere(0.024), mats.pupil, eye, 0, 0, 0.016).scale.set(0.45, 1, 0.4);
    return eye;
  });

  mesh(sphere(0.075), mats.muzzle, head, 0, -0.05, 0.15).scale.set(1.3, 0.8, 0.8);
  mesh(sphere(0.022), mats.nose, head, 0, -0.025, 0.213).scale.set(1.2, 0.8, 0.8);
  const mouth = mesh(sphere(0.028), mats.mouth, head, 0, -0.085, 0.185);

  const whiskerGeo = new THREE.CylinderGeometry(0.0025, 0.001, 0.17, 4);
  for (const side of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      const pivot = group(head, side * 0.06, -0.05 + k * 0.012, 0.19);
      pivot.rotation.set(0, -side * 0.25, -side * (Math.PI / 2 - k * 0.22));
      mesh(whiskerGeo, mats.whisker, pivot, 0, 0.085, 0).castShadow = false;
    }
  }

  // Legs: FL, FR, RL, RR
  const upperLen = 0.22;
  const lowerLen = 0.22;
  const legs = [];
  for (const [x, z, front] of [[-0.12, 0.27, true], [0.12, 0.27, true], [-0.13, -0.27, false], [0.13, -0.27, false]]) {
    const hip = group(body, x, -0.1, z);
    const upperR = front ? 0.058 : 0.078;
    mesh(new THREE.CapsuleGeometry(upperR, upperLen - 0.02, 6, 12), mats.legs, hip, 0, -upperLen / 2, 0);
    const knee = group(hip, 0, -upperLen, 0);
    mesh(new THREE.CapsuleGeometry(0.046, lowerLen - 0.02, 6, 12), mats.legs, knee, 0, -lowerLen / 2, 0);
    mesh(sphere(0.062), mats.paws, knee, 0, -lowerLen, 0.02).scale.set(1, 0.62, 1.3);
    probe(knee, 0.038, 0, -lowerLen, 0.01);
    legs.push({ hip, knee });
  }

  // Tail: a chain of segments, each extending along its local +Y
  const tailBase = group(body, 0, 0.08, -0.43);
  const tail = [];
  const segLen = 0.095;
  let parent = tailBase;
  for (let i = 0; i < TAIL_SEGMENTS; i++) {
    const seg = group(parent, 0, i === 0 ? 0 : segLen, 0);
    const mat = i >= TAIL_SEGMENTS - 2 ? mats.tailTip : i % 2 ? mats.tailRing : mats.tail;
    mesh(new THREE.CapsuleGeometry(0.043 - i * 0.003, segLen, 4, 10), mat, seg, 0, segLen / 2, 0);
    tail.push(seg);
    parent = seg;
  }

  function setFur(f) {
    const [earL, earR] = Array.isArray(f.ears) ? f.ears : [f.ears, f.ears];
    mats.body.color.set(f.body);
    mats.belly.color.set(f.belly);
    mats.muzzle.color.set(f.muzzle);
    mats.legs.color.set(f.legs);
    mats.paws.color.set(f.paws);
    mats.earL.color.set(earL);
    mats.earR.color.set(earR);
    mats.earInner.color.set(f.earInner);
    mats.tail.color.set(f.tail);
    mats.tailRing.color.set(f.stripes ?? f.tail);
    mats.tailTip.color.set(f.tailTip);
    mats.stripe.color.set(f.stripes ?? f.body);
    mats.nose.color.set(f.nose);
    mats.iris.color.set(f.eyes);
    mats.iris.emissive.set(f.eyes).multiplyScalar(0.18);
    stripes.visible = headStripes.visible = !!f.stripes;
    patches.visible = headPatch.visible = !!f.patches;
  }
  setFur(FURS[0]);

  return { root, body, headPivot, head, ears, eyes, mouth, legs, tailBase, tail, probes, setFur };
}
