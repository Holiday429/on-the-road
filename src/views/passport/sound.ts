/* ==========================================================================
   On the Road · Passport — sounds
   --------------------------------------------------------------------------
   Three small sounds synthesised with the Web Audio API (no audio files to
   ship): a paper swish for a page turn, a dull thump for the stamp, a muffled
   close for the cover. On by default; the switch is remembered per device.
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
  g.gain.exponentialRampToValueAtTime(o.gain, t0 + Math.min(0.02, o.dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0, Math.random() * 0.5, o.dur + 0.05);
}

/**
 * The shape of one page turn, drawn fresh each time so no two sound alike: a soft swish whose pitch
 * rises as the sheet lifts and falls as it lands, the tiny crackle of paper fibres inside it, and a
 * muffled pat when the sheet settles. Pure, so the shape can be tested without audio.
 */
export interface FlipPlan {
  /** Length of the swish, s. */
  dur: number;
  /** Band-pass centre at the start, the middle and the end of the swish, Hz. */
  sweep: [number, number, number];
  /** Offsets (s) and gains of the fibre crackle. */
  ticks: Array<{ at: number; gain: number; freq: number }>;
  /** When the sheet lands, s. */
  land: number;
}

export function flipPlan(rand: () => number = Math.random): FlipPlan {
  const dur = 0.38 + rand() * 0.14;
  const lo = 1500 + rand() * 500;
  const n = 5 + Math.floor(rand() * 5);
  return {
    dur,
    sweep: [lo, lo * (2 + rand() * 0.6), lo * (1.1 + rand() * 0.3)],
    ticks: Array.from({ length: n }, () => ({ at: 0.04 + rand() * (dur - 0.08), gain: 0.012 + rand() * 0.03, freq: 3200 + rand() * 3000 })),
    land: dur * (0.82 + rand() * 0.1),
  };
}

/** A page turning: paper, not a switch — a smooth swish with fibre crackle and a soft landing. */
export function playFlip(): void {
  const c = audio();
  if (!c) return;
  const p = flipPlan();
  const t0 = c.currentTime;
  // The swish: broadband noise through a slow band-pass sweep, with a gentle rise and fall (no hard edge).
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const band = c.createBiquadFilter();
  band.type = 'bandpass'; band.Q.value = 0.55;
  band.frequency.setValueAtTime(p.sweep[0], t0);
  band.frequency.exponentialRampToValueAtTime(p.sweep[1], t0 + p.dur * 0.45);
  band.frequency.exponentialRampToValueAtTime(p.sweep[2], t0 + p.dur);
  const soft = c.createBiquadFilter();
  soft.type = 'lowpass'; soft.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.085, t0 + p.dur * 0.38);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
  src.connect(band).connect(soft).connect(g).connect(c.destination);
  src.start(t0, Math.random() * 0.5, p.dur + 0.05);
  // Fibres: a few very short, bright specks.
  for (const k of p.ticks) burst(c, { type: 'bandpass', freq: k.freq, q: 1.2, dur: 0.012, gain: k.gain, at: k.at });
  // The sheet settles on the pile.
  burst(c, { type: 'lowpass', freq: 1100, q: 0.5, dur: 0.07, gain: 0.05, at: p.land });
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

/** The cover opening or closing: stiff card and cloth, a low soft rub and a muffled close. */
export function playCover(): void {
  const c = audio();
  if (!c) return;
  burst(c, { type: 'lowpass', freq: 700, q: 0.5, dur: 0.3, gain: 0.1 });
  burst(c, { type: 'bandpass', freq: 1500, q: 0.6, dur: 0.22, gain: 0.04, at: 0.05 });
  burst(c, { type: 'lowpass', freq: 380, q: 0.5, dur: 0.1, gain: 0.07, at: 0.3 });
}
