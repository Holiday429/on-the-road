/* ==========================================================================
   On the Road · Passport — sounds
   --------------------------------------------------------------------------
   Three small sounds synthesised with the Web Audio API (no audio files to
   ship): paper rustle for a page turn, a dull thump for the stamp, a soft
   clap for the cover. On by default; the switch is remembered per device.
   Browsers only let sound start after a gesture — every call here comes from
   a click or a drag, and a refused context simply stays silent.
   ========================================================================== */

const KEY = 'otr:passportSound';

export function isSoundOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSoundOn(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* per-device nicety only */ }
}

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!isSoundOn() || typeof AudioContext === 'undefined') return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** Filtered noise with an exponential fade. */
function burst(c: AudioContext, o: { type: BiquadFilterType; freq: number; q?: number; dur: number; gain: number; at?: number }): void {
  const t0 = c.currentTime + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = o.type; f.frequency.value = o.freq; f.Q.value = o.q ?? 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0, Math.random() * 0.5, o.dur + 0.05);
}

/** A page turning. */
export function playFlip(): void {
  const c = audio();
  if (!c) return;
  burst(c, { type: 'bandpass', freq: 2600, q: 0.7, dur: 0.28, gain: 0.07 });
  burst(c, { type: 'highpass', freq: 5200, dur: 0.12, gain: 0.03, at: 0.1 });
}

/** The stamp landing; `strength` 0–1 is how hard it was pressed. */
export function playThunk(strength = 0.7): void {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(130, t0);
  o.frequency.exponentialRampToValueAtTime(48, t0 + 0.14);
  const peak = 0.18 + 0.32 * strength;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + 0.3);
  burst(c, { type: 'lowpass', freq: 900, dur: 0.1, gain: 0.08 + 0.1 * strength });
}

/** The cover opening or closing. */
export function playCover(): void {
  const c = audio();
  if (!c) return;
  burst(c, { type: 'lowpass', freq: 600, dur: 0.22, gain: 0.12 });
  burst(c, { type: 'bandpass', freq: 1800, dur: 0.15, gain: 0.04, at: 0.04 });
}
