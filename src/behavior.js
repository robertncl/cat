import * as THREE from 'three';
import { TAIL_SEGMENTS } from './cat.js';

const WALK = 1.3;
const RUN = 4.2;
const TUCK = [-1.3, 2.65]; // leg folded flat under the body

// Pose values. legs = [FL upper, FL lower, FR.., RL.., RR..]; negative upper = forward.
const STAND = {
  pitch: 0, roll: 0, yaw: 0,
  legs: [0.08, -0.16, 0.08, -0.16, -0.25, 0.5, -0.25, 0.5],
  headPitch: 0, headTilt: 0, look: 1,
  tailBase: -1.9, tailCurl: 0.28, tailWrap: 0, tailSway: 1,
  eyes: 0, mouth: 0,
};
const P = (o) => ({ ...STAND, ...o });

const SIT = P({ pitch: -0.65, legs: [0.65, 0, 0.65, 0, -0.65, 2.65, -0.65, 2.65], tailBase: -1.1, tailCurl: 0.1, tailWrap: 0.3 });
const LIE = P({ legs: [-1.2, -0.3, -1.2, -0.3, ...TUCK, ...TUCK], tailBase: -1.7, tailCurl: 0.05, tailWrap: 0.35 });
const CROUCH = P({ pitch: 0.08, legs: [0.6, -1.2, 0.6, -1.2, -0.75, 1.5, -0.75, 1.5], headPitch: -0.1, tailBase: -1.7, tailCurl: 0.1 });
const POSES = {
  idle: STAND,
  sit: SIT,
  lie: LIE,
  loaf: P({ legs: [...TUCK, ...TUCK, ...TUCK, ...TUCK], headPitch: 0.15, eyes: 0.55, tailBase: -1.7, tailCurl: 0.05, tailWrap: 0.42, tailSway: 0.3 }),
  sleep: P({ legs: LIE.legs, headPitch: 1.0, headTilt: -0.55, look: 0, eyes: 1, tailBase: -1.7, tailCurl: 0.05, tailWrap: 0.46, tailSway: 0 }),
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

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mixPose = (a, b, t) => {
  const out = { ...a, legs: a.legs.map((v, i) => lerp(v, b.legs[i], t)) };
  for (const k in a) if (k !== 'legs') out[k] = lerp(a[k], b[k], t);
  return out;
};

const tmp = new THREE.Vector3();

export class CatController {
  constructor(cat, audio) {
    this.cat = cat;
    this.audio = audio;
    this.target = new THREE.Vector3(0, 0, 2.5); // floor point the cat is interested in
    this.follow = true;
    this.onStatus = () => {};

    this.state = { name: 'idle', t: 0, sticky: false, auto: false };
    this.pose = { ...STAND, legs: [...STAND.legs] };
    this.heading = 0;
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
    if (this.moving || (name === 'pounce' && t < 0.8)) {
      turn = wrapAngle(Math.atan2(dx, dz) - this.heading);
      const rate = (4 + this.speed * 1.5) * dt;
      this.heading += clamp(turn, -rate, rate);
    }
    const wanted = this.moving ? (this.running ? RUN : dist > 1.6 ? WALK : WALK * 0.7) * Math.max(0.15, Math.cos(turn)) : 0;
    this.speed += (wanted - this.speed) * (1 - Math.exp(-dt * (wanted > this.speed ? 4 : 9)));

    let advance = this.speed;
    if (name === 'pounce' && t > 0.8 && t < 1.25) advance = this.pounceSpeed;
    pos.x += Math.sin(this.heading) * advance * dt;
    pos.z += Math.cos(this.heading) * advance * dt;
    cat.root.rotation.y = this.heading;

    // ----- Pose -----
    const fast = name === 'jump' || name === 'pounce';
    this.blend(this.targetPose(name, t, time), 1 - Math.exp(-dt * (fast ? 16 : 7)));
    this.apply(dt, time, dx, dz, dist);

    // ----- Status text -----
    const status = name === 'idle'
      ? (this.running ? 'Running!' : this.moving ? 'Following' : this.purrT > 0 ? 'Purring' : 'Standing')
      : def.status;
    if (status !== this.status) {
      this.status = status;
      this.onStatus(status, name);
    }
  }

  targetPose(name, t, time) {
    this.lift = 0;
    switch (name) {
      case 'groom': {
        const lick = Math.sin(t * 9);
        return P({
          ...SIT,
          legs: [-1.25, -0.9 + 0.14 * lick, 0.65, 0, -0.65, 2.65, -0.65, 2.65],
          headPitch: 0.5 + 0.09 * lick, look: 0, eyes: 0.75, mouth: 0.35,
        });
      }
      case 'stretch': {
        const yawn = smooth((t - 0.7) / 0.5) * (1 - smooth((t - 1.9) / 0.5));
        return P({
          pitch: 0.45, legs: [-1.55, 0, -1.55, 0, -0.5, 0.1, -0.5, 0.1],
          headPitch: -0.3 - 0.25 * yawn, look: 0.3, eyes: 0.5 + 0.5 * yawn, mouth: yawn,
          tailBase: -0.9, tailCurl: 0.12,
        });
      }
      case 'roll': {
        const w = Math.sin(t * 5);
        const paddle = 0.35 * Math.sin(t * 7);
        return P({
          roll: Math.PI + 0.45 * w,
          legs: [-0.9 + paddle, 1.3, -0.9 - paddle, 1.3, -0.5 - paddle, 1.2, -0.5 + paddle, 1.2],
          look: 0, headTilt: -0.3, eyes: 0.6, tailBase: -1.6, tailCurl: 0.05, tailWrap: 0.25 * w,
        });
      }
      case 'jump': {
        if (t < 0.3) return CROUCH;
        if (t < 0.85) {
          const u = (t - 0.3) / 0.55;
          this.lift = 1.2 * 4 * u * (1 - u);
          return P({
            pitch: -0.45 * Math.cos(Math.PI * u), legs: [-0.9, 0.3, -0.9, 0.3, 0.7, 0.3, 0.7, 0.3],
            tailBase: -1.2, tailCurl: 0.08,
          });
        }
        return mixPose(CROUCH, STAND, (t - 0.85) / 0.25);
      }
      case 'pounce': {
        if (t < 0.8) {
          // Low crouch with the classic pre-pounce bottom wiggle.
          return P({ ...CROUCH, pitch: -0.08, yaw: 0.07 * Math.sin(t * 24), tailSway: 2.5 });
        }
        if (t < 1.25) {
          const u = (t - 0.8) / 0.45;
          this.lift = 0.5 * 4 * u * (1 - u);
          return P({
            pitch: -0.3 + 0.7 * u, legs: [-1.3, 0.2, -1.3, 0.2, 0.8 - u, 0.3, 0.8 - u, 0.3],
            tailBase: -1.3, tailCurl: 0.05,
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
      if (key === 'legs') for (let i = 0; i < 8; i++) p.legs[i] += (to.legs[i] - p.legs[i]) * k;
      else p[key] += (to[key] - p[key]) * k;
    }
  }

  apply(dt, time, dx, dz, dist) {
    const { cat, pose: p } = this;

    // Gait: trot when walking (diagonal pairs), blending to a gallop when running.
    const g = clamp(this.speed / WALK, 0, 1);
    const r = clamp((this.speed - WALK) / (RUN - WALK), 0, 1);
    this.phase += dt * this.speed * lerp(7.8, 3, r);
    const swing = (0.42 + 0.4 * r) * g;
    const bend = (0.8 + 0.3 * r) * g;
    const offsets = [0, lerp(Math.PI, 0.5, r), Math.PI, lerp(0, Math.PI + 0.5, r)];
    cat.legs.forEach((leg, i) => {
      const ph = this.phase + offsets[i];
      leg.hip.rotation.x = p.legs[i * 2] + swing * Math.sin(ph);
      leg.knee.rotation.x = p.legs[i * 2 + 1] + bend * Math.max(0, -Math.cos(ph));
    });

    // Purring makes the whole cat tremble slightly; sleeping slows the breathing.
    this.purrT = Math.max(0, this.purrT - dt);
    const purr = smooth(this.purrT / 0.4);
    const breath = Math.sin(time * (p.eyes > 0.9 ? 1.6 : 2.6));
    cat.body.rotation.set(p.pitch + r * g * 0.1 * Math.sin(this.phase), p.yaw, p.roll);
    cat.body.scale.set(1 + 0.012 * breath, 1 + 0.012 * breath, 1);
    cat.body.position.x = purr * 0.004 * Math.sin(time * 170);

    // Head: keep it level against body pitch, then look toward the pointer.
    this.meowT = Math.max(0, this.meowT - dt);
    const meow = Math.sin(Math.PI * clamp(this.meowT / 0.75, 0, 1));
    cat.headPivot.rotation.x = p.headPitch - p.pitch * 0.9 - 0.3 * meow;

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
    cat.head.rotation.set(this.lookPitch * p.look + p.headTilt, this.lookYaw * p.look, 0);

    // Eyes, ears, mouth
    this.nextBlink -= dt;
    if (this.nextBlink < 0) {
      this.blinkT = 0.16;
      this.nextBlink = 2 + Math.random() * 4;
    }
    this.blinkT = Math.max(0, this.blinkT - dt);
    const closed = Math.max(p.eyes, this.blinkT > 0 ? 1 : 0, purr * 0.85);
    for (const eye of cat.eyes) eye.scale.y = 1 - 0.92 * closed;
    const twitch = Math.max(0, Math.sin(time * 0.9) - 0.97) * 12;
    cat.ears.forEach((ear, i) => { ear.rotation.x = -0.25 * r + (i ? twitch : 0); });
    const open = Math.max(p.mouth, meow);
    cat.mouth.scale.set(1 + 0.3 * open, 0.15 + 1.1 * open, 1);
    cat.mouth.position.y = -0.085 - 0.02 * open;

    // Tail: lifts when moving, sways lazily otherwise.
    cat.tailBase.rotation.x = p.tailBase + g * 1.1;
    const curl = p.tailCurl - g * 0.2;
    cat.tail.forEach((seg, i) => {
      seg.rotation.x = i === 0 ? 0 : curl;
      const wave = Math.sin(time * 2.2 - i * 0.6) * 0.08 * p.tailSway * (0.3 + i / TAIL_SEGMENTS);
      seg.rotation.z = p.tailWrap + wave;
    });

    // Rest the lowest part of the cat on the floor, whatever the pose.
    cat.body.position.y = 0;
    cat.root.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const { obj, r: radius } of cat.probes) {
      lowest = Math.min(lowest, obj.getWorldPosition(tmp).y - radius);
    }
    cat.body.position.y = -lowest + this.lift + r * g * 0.06 * Math.abs(Math.sin(this.phase));
  }
}
