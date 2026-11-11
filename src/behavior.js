import * as THREE from 'three';

const WALK = 1.3;
const RUN = 4.2;
const TAU = Math.PI * 2;

// ---------- Poses ----------
// Angles are bone rotations away from the standing rest pose. For legs, each chain is
// [upper, lower, paw] and a positive angle swings the far end of the bone backward.
// `legs` lists FL, FR, HL, HR. `ik` says, per leg, how much the foot is planted on the floor
// (solved by inverse kinematics) rather than posed by those angles.

const REST = [0, 0, 0];
const legs = (fl, hl = fl, fr = fl, hr = hl) => [...fl, ...fr, ...hl, ...hr];
const PLANTED = [1, 1, 1, 1];
const POSED = [0, 0, 0, 0];

const STAND = {
  y: 0, z: 0, pitch: 0, roll: 0, yaw: 0, spine: 0, // hips offset and rotation, spine curl
  legs: legs(REST), splay: 0, ik: PLANTED,
  headPitch: 0, headTilt: 0, look: 1,
  tailLift: -0.75, tailCurl: 0.13, tailWrap: 0, tailSway: 1,
  eyes: 0, mouth: 0, pupil: 0.3,
};
const P = (o) => ({ ...STAND, ...o });

const FOLDED_HIND = [-0.76, 1.09, -1.5]; // tucked under a lying body
const REACHING_FORE = [0.78, -2.29, 0.9]; // forearms flat on the floor, sphinx-style
const TUCKED_FORE = [0.9, -2.84, 1.84];
const ON_FLOOR = { y: -0.34, ik: POSED, splay: 0.28, tailLift: 0, tailCurl: 0.01 };

const SIT = P({
  y: -0.34, z: 0.1, pitch: -1.0, spine: 0.27, legs: legs(REST, [-0.06, 1.07, -1.18]) /* hind legs folded, feet flat */, splay: 0.28, ik: [1, 1, 0, 0],
  tailLift: 0, tailCurl: 0.01, tailWrap: 0.33,
});
const LIE = P({ ...ON_FLOOR, legs: legs(REACHING_FORE, FOLDED_HIND), tailWrap: 0.3 });
const CROUCH = P({ y: -0.13, pitch: 0.05, headPitch: -0.1, tailLift: -0.3, tailCurl: 0.05, pupil: 0.5 });
const POSES = {
  idle: STAND,
  sit: SIT,
  lie: LIE,
  loaf: P({ ...ON_FLOOR, legs: legs(TUCKED_FORE, FOLDED_HIND), headPitch: 0.12, eyes: 0.55, tailWrap: 0.36, tailSway: 0.3 }),
  sleep: P({ ...ON_FLOOR, legs: LIE.legs, headPitch: 0.8, headTilt: -0.45, look: 0, eyes: 1, tailWrap: 0.38, tailSway: 0 }),
};

// hold: stays until interrupted. dur: plays once then returns to idle.
export const ACTIONS = {
  sit: { label: 'Sit', key: 's', status: 'Sitting', hold: true },
  lie: { label: 'Lie down', key: 'l', status: 'Lying down', hold: true },
  loaf: { label: 'Loaf', key: 'f', status: 'Loafing', hold: true },
  sleep: { label: 'Sleep', key: 'z', status: 'Sleeping… zzz', hold: true },
  groom: { label: 'Groom', key: 'g', status: 'Grooming', dur: 4.5 },
  stretch: { label: 'Stretch', key: 't', status: 'Streeetching', dur: 3 },
  roll: { label: 'Roll over', key: 'r', status: 'Rolling around', dur: 3.6 },
  jump: { label: 'Jump', key: 'j', status: 'Jumping', dur: 1.1 },
  pounce: { label: 'Pounce', key: 'p', status: 'Pouncing!', dur: 1.6 },
  meow: { label: 'Meow', key: 'm', overlay: true },
  purr: { label: 'Purr', key: 'u', overlay: true },
};

// Footfall timing as a fraction of the stride, per leg (FL, FR, HL, HR).
const WALK_BEAT = [0.25, 0.75, 0, 0.5]; // left hind, left fore, right hind, right fore
const GALLOP_BEAT = [0.55, 0.67, 0, 0.12]; // hind pair, then fore pair

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mixPose = (a, b, t) => {
  const out = {};
  for (const k in a) out[k] = Array.isArray(a[k]) ? a[k].map((v, i) => lerp(v, b[k][i], t)) : lerp(a[k], b[k], t);
  return out;
};

const tmp = new THREE.Vector3();
const home = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CatController {
  constructor(cat, audio) {
    this.cat = cat;
    this.audio = audio;
    this.target = new THREE.Vector3(0, 0, 2.5); // floor point the cat is interested in
    this.follow = true;
    this.onStatus = () => {};

    this.state = { name: 'idle', t: 0, sticky: false, auto: false };
    this.pose = mixPose(STAND, STAND, 0);
    this.heading = 0;
    this.turnRate = 0;
    this.speed = 0;
    this.moving = false;
    this.running = false;
    this.phase = 0;
    this.lift = 0;
    this.still = 0; // seconds since the pointer last moved
    this.lastTarget = this.target.clone();
    this.meowT = 0;
    this.purrT = 0;
    this.blinkT = 0;
    this.nextBlink = 2;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.pounceSpeed = 0;
    this.status = '';
    // Where each foot is on the floor, in world space.
    this.feet = cat.legs.map((leg) => ({ pos: leg.home.clone(), from: new THREE.Vector3(), swing: false, u: 0, armed: true }));
  }

  /** Trigger an action by name (see ACTIONS). */
  do(name) {
    const def = ACTIONS[name];
    if (!def) return;
    if (name === 'meow') {
      this.meowT = 0.75;
      this.audio.meow();
    } else if (name === 'purr') {
      this.purrT = 3;
      this.audio.purr(3);
    } else if (def.hold && this.state.name === name) {
      this.call(); // pressing a held pose again releases it
    } else {
      this.set(name, { sticky: !!def.hold });
    }
  }

  /** Get the cat up and following again. */
  call() {
    this.still = 0;
    if (this.state.name !== 'idle' && !ACTIONS[this.state.name].dur) this.set('idle');
    else this.state.sticky = false;
  }

  set(name, { sticky = false, auto = false } = {}) {
    this.state = { name, t: 0, sticky, auto };
    if (name === 'pounce') {
      const d = Math.hypot(this.target.x - this.cat.root.position.x, this.target.z - this.cat.root.position.z);
      this.pounceSpeed = clamp(d, 1, 3.2) / 0.45;
    }
  }

  update(dt, time) {
    const { cat, state, target } = this;
    const pos = cat.root.position;
    state.t += dt;

    if (target.distanceToSquared(this.lastTarget) > 0.0025) {
      this.still = 0;
      this.lastTarget.copy(target);
    } else {
      this.still += dt;
    }

    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const def = ACTIONS[state.name];

    // ----- State transitions -----
    if (def?.dur && state.t >= def.dur) {
      const settle = state.auto && this.still > 12;
      this.set(settle ? 'lie' : 'idle', { auto: settle });
    } else if (def?.hold && !state.sticky && this.follow && dist > 1.6 && this.still < 0.5) {
      this.set('idle'); // a pose the cat chose itself ends when the pointer wanders off
    } else if (state.name === 'idle' && !this.moving && this.speed < 0.05 && this.still > 5) {
      this.set('sit', { auto: true });
    } else if (state.auto && state.name === 'sit' && this.still > 12) {
      this.set(['groom', 'loaf', 'lie'][Math.floor(Math.random() * 3)], { auto: true });
    } else if (state.auto && (state.name === 'loaf' || state.name === 'lie') && this.still > 28) {
      this.set('sleep', { auto: true });
    }
    const name = this.state.name;
    const t = this.state.t;

    // ----- Locomotion -----
    if (name === 'idle' && this.follow) {
      if (!this.moving && dist > 1.3) this.moving = true;
      else if (this.moving && dist < 0.8) this.moving = false;
    } else {
      this.moving = false;
    }
    if (!this.moving || dist < 3) this.running = false;
    else if (dist > 4.5) this.running = true;

    let turn = 0;
    const headingBefore = this.heading;
    if (this.moving || (name === 'pounce' && t < 0.8)) {
      turn = wrapAngle(Math.atan2(dx, dz) - this.heading);
      const rate = (4 + this.speed * 1.5) * dt;
      this.heading += clamp(turn, -rate, rate);
    }
    if (dt > 1e-4) this.turnRate += ((this.heading - headingBefore) / dt - this.turnRate) * (1 - Math.exp(-dt * 10));
    const wanted = this.moving ? (this.running ? RUN : dist > 1.6 ? WALK : WALK * 0.7) * Math.max(0.15, Math.cos(turn)) : 0;
    this.speed += (wanted - this.speed) * (1 - Math.exp(-dt * (wanted > this.speed ? 4 : 9)));

    let advance = this.speed;
    if (name === 'pounce' && t > 0.8 && t < 1.25) advance = this.pounceSpeed;
    pos.x += Math.sin(this.heading) * advance * dt;
    pos.z += Math.cos(this.heading) * advance * dt;
    cat.root.rotation.y = this.heading;

    // ----- Pose -----
    const fast = name === 'jump' || name === 'pounce';
    this.blend(this.targetPose(name, t), 1 - Math.exp(-dt * (fast ? 16 : 6)));
    this.apply(dt, time, dx, dz, dist);

    // ----- Status text -----
    const status = name === 'idle'
      ? (this.running ? 'Running!' : this.moving ? 'Following' : this.purrT > 0 ? 'Purring' : 'Standing')
      : ACTIONS[name].status; // not `def`: the state may have just changed
    if (status !== this.status) {
      this.status = status;
      this.onStatus(status, name);
    }
  }

  targetPose(name, t) {
    this.lift = 0;
    switch (name) {
      case 'groom': {
        const lick = Math.sin(t * 9);
        return P({
          ...SIT,
          legs: legs([-0.72, -1.37 + 0.15 * lick, 0.84], SIT.legs.slice(6, 9), REST),
          ik: [0, 1, 0, 0],
          headPitch: 0.7 + 0.09 * lick, headTilt: 0.2, look: 0, eyes: 0.75, mouth: 0.35,
        });
      }
      case 'stretch': {
        // Play bow: rump up on planted hind feet, chest down, forelegs slid out in front.
        const yawn = smooth((t - 0.7) / 0.5) * (1 - smooth((t - 1.9) / 0.5));
        return P({
          y: -0.03, z: -0.07, pitch: 0.75, spine: -0.1,
          legs: legs([-2.32, 0.26, 0.9], REST), ik: [0, 0, 1, 1],
          headPitch: -0.3 - 0.25 * yawn, look: 0.3, eyes: 0.5 + 0.5 * yawn, mouth: yawn,
          tailLift: 0.9, tailCurl: 0.1,
        });
      }
      case 'roll': {
        const w = Math.sin(t * 5);
        const paddle = 0.35 * Math.sin(t * 7);
        return P({
          ...ON_FLOOR, roll: Math.PI + 0.45 * w,
          legs: legs([-0.5 + paddle, -1.2, 0.9], [-0.4 - paddle, 0.6, -0.4], [-0.5 - paddle, -1.2, 0.9], [-0.4 + paddle, 0.6, -0.4]),
          look: 0, headTilt: -0.3, eyes: 0.6, tailCurl: 0.05, tailWrap: 0.25 * w, pupil: 0.5,
        });
      }
      case 'jump': {
        if (t < 0.3) return CROUCH;
        if (t < 0.85) {
          const u = (t - 0.3) / 0.55;
          this.lift = 1.2 * 4 * u * (1 - u);
          return P({
            pitch: -0.45 * Math.cos(Math.PI * u), legs: legs([-0.9, -0.74, 0.84], [0.9, -0.5, 0.5]), ik: POSED,
            tailLift: -0.2, tailCurl: 0.06, pupil: 0.5,
          });
        }
        return mixPose(CROUCH, STAND, (t - 0.85) / 0.25);
      }
      case 'pounce': {
        if (t < 0.8) {
          // Low crouch with the classic pre-pounce bottom wiggle.
          return P({ ...CROUCH, y: -0.15, pitch: 0.07, yaw: 0.07 * Math.sin(t * 24), tailSway: 2.5, pupil: 0.58 });
        }
        if (t < 1.25) {
          const u = (t - 0.8) / 0.45;
          this.lift = 0.5 * 4 * u * (1 - u);
          return P({
            pitch: -0.3 + 0.7 * u, legs: legs([-1.0, -0.64, 0.74], [0.8 - u, -0.4, 0.4]), ik: POSED,
            tailLift: -0.1, tailCurl: 0.04, pupil: 0.58,
          });
        }
        return mixPose(CROUCH, STAND, (t - 1.25) / 0.35);
      }
      default:
        return POSES[name];
    }
  }

  blend(to, k) {
    const p = this.pose;
    for (const key in to) {
      if (Array.isArray(to[key])) for (let i = 0; i < to[key].length; i++) p[key][i] += (to[key][i] - p[key][i]) * k;
      else p[key] += (to[key] - p[key]) * k;
    }
  }

  apply(dt, time, dx, dz, dist) {
    const { cat, pose: p } = this;

    // Gait clock: one turn of `phase` is one full stride.
    const g = clamp(this.speed / WALK, 0, 1);
    const r = clamp((this.speed - WALK) / (RUN - WALK), 0, 1);
    const stride = this.speed > 0.05 ? 1.2 + 0.6 * this.speed : 2.2; // strides per second
    this.phase = (this.phase + dt * stride) % 1;
    const cyc = this.phase * TAU;
    const stance = lerp(0.65, 0.34, r); // fraction of the stride each foot spends on the ground
    const amble = g * (1 - r);

    this.purrT = Math.max(0, this.purrT - dt);
    this.meowT = Math.max(0, this.meowT - dt);
    const purr = smooth(this.purrT / 0.4);
    const meow = Math.sin(Math.PI * clamp(this.meowT / 0.75, 0, 1));

    // ----- Trunk -----
    // Walking sways the hips and snakes the spine; galloping rocks the body and flexes the back.
    cat.hips.position.set(
      cat.rest.hips.x + purr * 0.003 * Math.sin(time * 170), // purring trembles
      cat.rest.hips.y + p.y + this.lift - 0.018 * g + 0.005 * amble * Math.cos(2 * cyc) + 0.03 * r * Math.sin(cyc + 0.5),
      cat.rest.hips.z + p.z,
    );
    cat.hips.rotation.set(
      p.pitch + 0.09 * r * Math.sin(cyc - 0.6),
      p.yaw - 0.035 * amble * Math.sin(cyc),
      p.roll + 0.03 * amble * Math.sin(cyc),
    );
    const lean = clamp(this.turnRate * 0.09, -0.3, 0.3); // curve the body into a turn
    const flex = 0.2 * r * Math.sin(cyc + 1.0);
    const snake = 0.04 * amble * Math.sin(cyc);
    cat.spine.rotation.set(p.spine + flex, lean + snake, 0);
    cat.chest.rotation.set(p.spine - flex * 0.5, lean + snake, 0);
    const breath = 1 + 0.018 * Math.sin(time * (p.eyes > 0.9 ? 1.6 : 2.6)); // sleeping slows the breathing
    cat.spine.scale.set(breath, breath, 1);
    cat.chest.scale.set(1 / breath, 1 / breath, 1);
    const chestPitch = cat.hips.rotation.x + cat.spine.rotation.x + cat.chest.rotation.x;

    // ----- Head: stays level whatever the body does, and looks toward the pointer -----
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const near = smooth((dist - 0.25) / 0.5);
    const yawTo = clamp(Math.atan2(lx, lz), -1.2, 1.2) * near;
    const pitchTo = clamp(Math.atan2(0.7, Math.max(dist, 0.4)), 0, 0.9) * 0.7;
    const k = 1 - Math.exp(-dt * 8);
    this.lookYaw += (yawTo - this.lookYaw) * k;
    this.lookPitch += (pitchTo - this.lookPitch) * k;
    const nod = (p.headPitch + this.lookPitch * p.look - 0.3 * meow - chestPitch * 0.92) / 2;
    const swivel = this.lookYaw * p.look - lean;
    cat.neck.rotation.set(nod, swivel * 0.4, 0);
    cat.head.rotation.set(nod, swivel * 0.6, p.headTilt);

    // ----- Eyes, ears, mouth -----
    this.nextBlink -= dt;
    if (this.nextBlink < 0) {
      this.blinkT = 0.16;
      this.nextBlink = 2 + Math.random() * 4;
    }
    this.blinkT = Math.max(0, this.blinkT - dt);
    const closed = Math.max(p.eyes, this.blinkT > 0 ? 1 : 0, purr * 0.85);
    for (const lid of cat.lids) {
      lid.rotation.x = lerp(-1.0, 1.25, closed); // the lid tips forward over the eye…
      lid.parent.scale.y = 1 - 0.78 * closed; // …and the eye narrows to a slit
    }
    cat.eye.uPupil.value = p.pupil;
    const twitch = Math.max(0, Math.sin(time * 0.9) - 0.97) * 12;
    cat.ears.forEach((ear, i) => ear.rotation.set(-0.35 * r - 0.15 * purr, 0, i ? -twitch : 0));
    const open = Math.max(p.mouth, meow);
    cat.mouth.scale.set(1 + 0.3 * open, 0.12 + 1.1 * open, 1);
    cat.mouth.position.y = cat.rest.mouth.y - 0.012 * open;

    // ----- Tail: carried high on the move, swaying lazily otherwise, trailing through turns -----
    const carry = g * (1 - 0.5 * r);
    const trail = -clamp(this.turnRate * 0.04, -0.15, 0.15);
    cat.tail.forEach((seg, i) => {
      const wave = Math.sin(time * 2.2 - i * 0.6) * 0.07 * p.tailSway * (0.3 + i / cat.tail.length);
      const pitch = i === 0 ? p.tailLift - cat.hips.rotation.x + 1.5 * carry : p.tailCurl - 0.09 * carry;
      seg.rotation.set(pitch, p.tailWrap + wave + trail, 0);
    });

    // ----- Legs, posed -----
    cat.legs.forEach((leg, i) => {
      leg.upper.position.z = leg.restZ;
      leg.upper.rotation.set(p.legs[i * 3], 0, leg.side * p.splay * (leg.front ? 0.3 : 1));
      leg.lower.rotation.x = p.legs[i * 3 + 1];
      leg.paw.rotation.x = p.legs[i * 3 + 2];
    });

    // Rest on the floor: if any part of the posed cat would sink into it, lift the cat.
    cat.root.updateMatrixWorld(true);
    let lowest = 0;
    for (const probe of cat.probes) {
      if (!probe.rests) continue; // the head may dip below its resting height
      const planted = probe.leg >= 0 ? p.ik[probe.leg] : 0; // planted feet are placed by IK instead
      lowest = Math.min(lowest, probe.bone.localToWorld(tmp.copy(probe.offset)).y - probe.r + planted * 0.5);
    }
    cat.hips.position.y -= lowest;
    cat.root.updateMatrixWorld(true);

    // ----- Legs, planted -----
    // Each foot stays put on the floor while the body travels over it, then swings to its next footfall.
    const swingTime = (1 - stance) / stride;
    const reach = this.speed * (stance / stride) * 0.5; // land this far ahead so the stride is centred
    const stepHeight = lerp(0.035, 0.085, r) + 0.02 * (1 - g);
    const idleNow = this.speed < 0.05 && Math.abs(this.turnRate) < 0.2;
    cat.legs.forEach((leg, i) => {
      const foot = this.feet[i];
      const weight = p.ik[i];
      home.set(leg.home.x, 0, leg.home.z + reach).applyAxisAngle(UP, this.heading).add(cat.root.position);
      if (weight < 0.05) {
        // Fully posed: forget the old footprint so the foot lands under the body next time.
        foot.pos.copy(home);
        foot.swing = false;
        return;
      }

      const beat = (this.phase + lerp(WALK_BEAT[i], GALLOP_BEAT[i], r)) % 1;
      const due = beat < 1 - stance;
      const off = Math.hypot(foot.pos.x - home.x, foot.pos.z - home.z);
      if (!due) foot.armed = true;
      if (!foot.swing && ((due && foot.armed) || off > 0.6)) {
        foot.armed = false;
        if (!(idleNow && off < 0.03)) { // already where it belongs: no need to step
          foot.swing = true;
          foot.u = 0;
          foot.from.copy(foot.pos);
        }
      }
      let flick = 0;
      if (foot.swing) {
        foot.u = Math.min(1, foot.u + dt / swingTime);
        foot.pos.lerpVectors(foot.from, home, smooth(foot.u));
        foot.pos.y = stepHeight * Math.sin(Math.PI * foot.u);
        flick = Math.sin(Math.PI * foot.u);
        if (foot.u >= 1) foot.swing = false;
      }

      const sol = this.solveLeg(leg, foot.pos, weight);
      const parentPitch = leg.front ? chestPitch : cat.hips.rotation.x;
      const level = -(parentPitch + sol.upper + sol.lower) + flick * (leg.front ? 0.9 : 0.5); // keep the paw flat; curl it in the air
      leg.upper.rotation.x = lerp(leg.upper.rotation.x, sol.upper, weight);
      leg.upper.rotation.z = lerp(leg.upper.rotation.z, sol.splay, weight);
      leg.lower.rotation.x = lerp(leg.lower.rotation.x, sol.lower, weight);
      leg.paw.rotation.x = lerp(leg.paw.rotation.x, level, weight);
    });

    // Fur streams back a little at speed.
    cat.fur.uWind.value.set(-lean * 0.6, 0, -this.speed * 0.09);
  }

  /** Two-bone IK: the joint angles that put this leg's wrist / hock above the given foot position. */
  solveLeg(leg, footPos, weight) {
    const parent = leg.upper.parent;
    tmp.copy(leg.ankle).applyAxisAngle(UP, this.heading).add(footPos);
    parent.worldToLocal(tmp);
    if (leg.front) {
      // Shoulder blades slide under the skin, lengthening the stride.
      const slide = clamp((tmp.z - leg.restZ) * 0.3, -0.05, 0.05) * weight;
      leg.upper.position.z = leg.restZ + slide;
    }
    tmp.sub(leg.upper.position);

    const down = Math.hypot(tmp.x, tmp.y);
    const d = clamp(Math.hypot(down, tmp.z), Math.abs(leg.len1 - leg.len2) + 0.01, leg.len1 + leg.len2 - 0.002);
    const aim = Math.atan2(tmp.z, down); // direction to the target, forward of straight-down
    const inner = Math.acos(clamp((leg.len1 ** 2 + d * d - leg.len2 ** 2) / (2 * leg.len1 * d), -1, 1));
    const a1 = aim + leg.bend * inner;
    const a2 = Math.atan2(d * Math.sin(aim) - leg.len1 * Math.sin(a1), d * Math.cos(aim) - leg.len1 * Math.cos(a1));
    const upper = leg.rest1 - a1;
    return { upper, lower: leg.rest2 - a2 - upper, splay: Math.atan2(tmp.x, -tmp.y) };
  }
}
