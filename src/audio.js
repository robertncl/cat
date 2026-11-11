// Small synthesised cat sounds (no audio files needed).
export class CatAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Must be called from a user gesture at least once for browsers to allow audio.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() {
    return this.ctx && !this.muted;
  }

  meow() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pitch = 0.9 + Math.random() * 0.3;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520 * pitch, t);
    osc.frequency.linearRampToValueAtTime(860 * pitch, t + 0.14);
    osc.frequency.linearRampToValueAtTime(760 * pitch, t + 0.38);
    osc.frequency.exponentialRampToValueAtTime(430 * pitch, t + 0.7);

    // A moving band-pass gives the "ee-ow" vowel shape.
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.Q.value = 3;
    formant.frequency.setValueAtTime(1100, t);
    formant.frequency.linearRampToValueAtTime(2300, t + 0.18);
    formant.frequency.exponentialRampToValueAtTime(800, t + 0.7);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    gain.gain.setValueAtTime(0.5, t + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);

    osc.connect(formant).connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.75);
  }

  purr(duration = 3) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 26;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 280;

    // Slow "breathing" swell on top of the rumble.
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.3);
    gain.gain.setValueAtTime(0.35, t + duration - 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.8;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 0.12;
    breath.connect(breathDepth).connect(gain.gain);

    osc.connect(lowpass).connect(gain).connect(ctx.destination);
    osc.start(t);
    breath.start(t);
    osc.stop(t + duration);
    breath.stop(t + duration);
  }
}
