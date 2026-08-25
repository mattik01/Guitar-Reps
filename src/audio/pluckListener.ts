// Microphone single-pluck listener — the engine behind the picking routines.
//
// A SEPARATE engine from ChordListener rather than a mode inside it, because
// the two want genuinely different audio: ChordListener uses a 170 ms / 5.9 Hz
// window to resolve a chord's pitch classes and debounces to 4 events/s; a
// picking exercise needs a SHORT window (so the previous pick isn't inside it),
// ~16 events/s, and an onset timestamp accurate to a few milliseconds rather
// than to the 25 ms analysis tick — otherwise a "timing evenness" score would
// be measuring our own jitter. Sharing one class would mean two of everything
// inside a file that is already 539 lines.
//
// What IS shared: the getUserMedia flags, the asymmetric min-tracking noise
// floor, the adaptive spectral-flux onset test and the optional HP/LP filter
// front-end. Those were tuned against a real guitar and there is no reason to
// invent second versions.
//
//   source → [HP → LP] → onsetAnalyser (1024, ~21 ms)  → flux → onsets
//                      → specAnalyser  (4096, ~85 ms)  → pre/post magnitudes
//            (raw tap, always pre-filter)              → spectrum viz
//
// Each onset takes the delta between a spectrum snapshot from BEFORE it and the
// averaged snapshots 30–110 ms AFTER it, and hands that to scorePlucks() with
// the candidate pitches of the chord currently being held.

import type { ChordShape } from '../state/store';
import type { ListenerState } from './chordListener';
import { pluckCandidates, scorePlucks, type PluckCandidate, type PluckRank } from './pluck';

export type PluckEvent = {
  at: number;                 // performance.now() of the attack, sub-tick refined
  stringIndex: number | null; // null = we could not tell (never a guess)
  midi: number | null;
  ranked: PluckRank[];
  margin: number;
  strength: number;
  newness: number;            // winning string's gain over its own prior level
  attackRatio: number;        // pick-transient strength (high band vs its running level)
  // false = this onset added no new energy, i.e. a re-trigger on a note already
  // ringing. Emitted anyway, so the Pick Lab can SHOW re-triggers — an engine
  // that silently swallowed them made "picks went missing / doubled" impossible
  // to diagnose. Consumers must count only isNew (see PickSignal.isPick).
  isNew: boolean;
  ambiguous: boolean;
  level: number;              // peak RMS of the post-onset window
  delta: Float32Array;        // the onset-delta spectrum, for diagnostics/capture
};

// ---- loop & onset tuning ----------------------------------------------------
const PLUCK_INTERVAL_MS = 10;      // 100 Hz — 2.5× ChordListener's loop
const ONSET_FFT_SIZE = 1024;       // ~21 ms @48 kHz
export const PLUCK_FFT_SIZE = 4096; // ~85 ms @48 kHz, 11.7 Hz bins
const FLUX_LOW_HZ = 70;            // just under low E (82 Hz) — a pluck's attack is broadband
const FLUX_HIGH_HZ = 5000;
const FLUX_THRESHOLD_K = 2.6;      // slightly hotter than the chord engine: a single
                                   // string is quieter than six, and a missed pick
                                   // costs more here than a spurious one.
const FLUX_EMA_ALPHA = 0.02;       // ~0.5 s at 100 Hz
const MIN_RMS_ABS = 0.003;
const NOISE_GATE_RATIO = 3;
const NOISE_FLOOR_FALL_ALPHA = 0.04;
const NOISE_FLOOR_RISE_ALPHA = 0.0004;
const ONSET_REFRACTORY_MS = 90;    // ≈11 picks/s ceiling — still above 16ths at 150 bpm
// After an onset the detector must see flux fall back to this fraction of THAT
// ATTACK'S OWN peak before it may fire again. A pick's attack spans several
// 10 ms frames, and without the latch frames 2-3 of the same attack re-trigger
// the moment the refractory expires — measured as phantom picks on the
// synthetic bench. Relative to the attack rather than to the adaptive
// threshold, because the threshold itself moves in the wake of a loud onset;
// relative to the peak rather than to a time, so it costs nothing at speed.
const ONSET_REARM_RATIO = 0.25;
// A second onset arriving soon after another must have a comparable ATTACK to
// be believed. A real pick hits about as hard as the one before it; the frames
// that re-trigger off a single attack's tail are far weaker. Level-relative, so
// it adapts to how hard you happen to be playing.
const ONSET_ECHO_WINDOW_MS = 250;
const ONSET_MIN_ECHO_FLUX = 0.35;
// The pick CONTACTING the string is a brief broadband transient, concentrated
// well above the fundamentals. A real pluck has one; a spectral wobble in a
// decaying chord does not — and no amount of "did energy increase?" reasoning
// downstream can tell those apart once the strings are left ringing (which the
// exercise requires). So it is asked here, at the onset decision, where it
// belongs. Measured as the high band's jump over its own running level, so it is
// independent of how loud the chord underneath happens to be.
const ATTACK_BAND_LOW_HZ = 1500;
const ATTACK_BAND_HIGH_HZ = 5000;
const ATTACK_BAND_ALPHA = 0.1;
// NOT YET A GATE — reported only, deliberately.
//
// The physics is sound (a pick contacting a string makes a broadband burst; a
// wobble in a decaying chord does not), but how strong that burst looks against
// a loud ringing chord has never been measured on a real guitar, and dropping
// real picks is the worst failure this engine has. Gating on a guessed value
// deleted every real pick on the bench. `attackRatio` rides on every event and
// into the Pick Lab's capture file, so the constant can be set from the measured
// distribution and only THEN turned into a gate.
export const MIN_ATTACK_RATIO_UNUSED = 1.4;
// Post-onset window. Short on purpose: at 200 ms between picks (a brisk run),
// anything past ~120 ms starts eating the next attack.
const POST_ONSET_START_MS = 30;    // skip the broadband pick transient
const POST_ONSET_END_MS = 110;
// How far back the "before" snapshot is taken. The spec analyser's window is
// ~85 ms long, so a snapshot 40 ms before the attack still ends before it.
const PRE_SNAPSHOT_TICKS = 4;      // × PLUCK_INTERVAL_MS = 40 ms
const LEVEL_EMA_ALPHA = 0.3;
// Sub-tick onset timing: envelope RMS over this many samples, and the fraction
// of the buffer's peak envelope that counts as "the attack started here".
const ENVELOPE_WIN = 64;
const ENVELOPE_RISE_FRACTION = 0.25;
const FILTER_HP_HZ = 75;
const FILTER_HP_Q = 0.707;
const FILTER_LP_HZ = 7000;

type PendingOnset = {
  at: number;
  attackRatio: number;
  pre: Float32Array;
  accum: Float32Array;
  frames: number;
  rmsPeak: number;
};

export class PluckListener {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onsetAnalyser: AnalyserNode | null = null;
  private specAnalyser: AnalyserNode | null = null;
  private rawAnalyser: AnalyserNode | null = null;
  private rawSpec = new Float32Array(0);
  private hpFilter: BiquadFilterNode | null = null;
  private lpFilter: BiquadFilterNode | null = null;
  private filtersEnabled = false;
  private filterHpHz = FILTER_HP_HZ;
  private filterLpHz = FILTER_LP_HZ;
  private intervalId: number | null = null;

  private candidates: PluckCandidate[] = [];

  private pluckCbs = new Set<(e: PluckEvent) => void>();
  private stateCbs = new Set<(s: ListenerState) => void>();

  private _state: ListenerState = 'idle';
  private _error: string | null = null;

  private timeBuf = new Float32Array(0);
  private onsetSpec = new Float32Array(0);
  private prevOnsetLin = new Float32Array(0);
  private curOnsetLin = new Float32Array(0);
  private specDb = new Float32Array(0);
  private specLin = new Float32Array(0);
  // Ring of recent linear spectra, so an onset can look BACKWARDS for its
  // "before" picture. Written every tick; read only when an onset fires.
  private ring: Float32Array[] = [];
  private ringAt = 0;

  private fluxMean = 0;
  private fluxDev = 0;
  private noiseFloorRms = 0.001;
  private userGateRms = 0;
  private level = 0;
  private lastOnsetAt = -Infinity;
  private armed = true;
  private onsetFluxPeak = 0;
  private lastOnsetFluxPeak = 0;
  private attackBandEma = 0;
  private pending: PendingOnset[] = [];

  get state(): ListenerState { return this._state; }
  get error(): string | null { return this._error; }

  onPluck(cb: (e: PluckEvent) => void): () => void {
    this.pluckCbs.add(cb);
    return () => this.pluckCbs.delete(cb);
  }
  onStateChange(cb: (s: ListenerState) => void): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  /** The chord currently being held — its sounding strings are the candidates. */
  setShape(shape: ChordShape | null): void {
    this.candidates = shape ? pluckCandidates(shape) : [];
  }

  getCandidates(): PluckCandidate[] { return this.candidates; }

  // --- DetectionDetails-compatible surface -----------------------------------
  // Structurally the same `DetectionMic` the chord engine exposes, so the picking
  // screens show THE shared detection panel (sensitivity gate, filters, live
  // spectrum) instead of growing a second set of mic controls. Chroma is not
  // part of this engine, hence the flat vector.
  private static NO_CHROMA = new Float32Array(12);

  getLevel(): number {
    if (this.level <= 0) return 0;
    return Math.min(1, Math.max(0, (20 * Math.log10(this.level) + 60) / 60));
  }
  getLiveChroma(): Float32Array { return PluckListener.NO_CHROMA; }
  getSpectrum(): Float32Array {
    if (this.rawAnalyser) this.rawAnalyser.getFloatFrequencyData(this.rawSpec);
    return this.rawSpec;
  }
  getSpectrumMeta(): { sampleRate: number; fftSize: number } {
    return {
      sampleRate: this.ctx?.sampleRate ?? 44100,
      fftSize: this.rawAnalyser?.fftSize ?? PLUCK_FFT_SIZE,
    };
  }

  setMinLevel(level01: number): void {
    this.userGateRms = level01 <= 0 ? 0 : Math.pow(10, 3 * (level01 - 1));
  }

  setFilters(enabled: boolean): void {
    if (enabled === this.filtersEnabled) return;
    this.filtersEnabled = enabled;
    if (this.ctx) this.applyRouting();
  }

  setFilterParams(hpHz: number, lpHz: number): void {
    this.filterHpHz = Math.max(20, Math.min(300, hpHz || FILTER_HP_HZ));
    this.filterLpHz = Math.max(this.filterHpHz + 500, Math.min(16000, lpHz || FILTER_LP_HZ));
    if (this.hpFilter) this.hpFilter.frequency.value = this.filterHpHz;
    if (this.lpFilter) this.lpFilter.frequency.value = this.filterLpHz;
  }

  private applyRouting(): void {
    const src = this.source, hp = this.hpFilter, lp = this.lpFilter;
    const onset = this.onsetAnalyser, spec = this.specAnalyser;
    if (!src || !hp || !lp || !onset || !spec) return;
    src.disconnect();
    hp.disconnect();
    lp.disconnect();
    if (this.filtersEnabled) {
      src.connect(hp);
      hp.connect(lp);
      lp.connect(onset);
      lp.connect(spec);
    } else {
      src.connect(onset);
      src.connect(spec);
    }
    if (this.rawAnalyser) src.connect(this.rawAnalyser); // always pre-filter
  }

  async start(): Promise<void> {
    if (this._state === 'listening' || this._state === 'starting') return;
    this.setState('starting');
    try {
      // Same reasoning as ChordListener: voice processing destroys the very
      // dynamics an onset detector lives on.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const Ctor = window.AudioContext
        || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      await this.ctx.resume();

      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.onsetAnalyser = this.ctx.createAnalyser();
      this.onsetAnalyser.fftSize = ONSET_FFT_SIZE;
      this.onsetAnalyser.smoothingTimeConstant = 0;
      this.specAnalyser = this.ctx.createAnalyser();
      this.specAnalyser.fftSize = PLUCK_FFT_SIZE;
      this.specAnalyser.smoothingTimeConstant = 0;
      this.rawAnalyser = this.ctx.createAnalyser();
      this.rawAnalyser.fftSize = PLUCK_FFT_SIZE;
      this.rawAnalyser.smoothingTimeConstant = 0;
      this.hpFilter = this.ctx.createBiquadFilter();
      this.hpFilter.type = 'highpass';
      this.hpFilter.frequency.value = this.filterHpHz;
      this.hpFilter.Q.value = FILTER_HP_Q;
      this.lpFilter = this.ctx.createBiquadFilter();
      this.lpFilter.type = 'lowpass';
      this.lpFilter.frequency.value = this.filterLpHz;
      this.rawSpec = new Float32Array(this.rawAnalyser.frequencyBinCount);
      this.applyRouting();

      const bins = this.specAnalyser.frequencyBinCount;
      this.timeBuf = new Float32Array(ONSET_FFT_SIZE);
      this.onsetSpec = new Float32Array(this.onsetAnalyser.frequencyBinCount);
      this.prevOnsetLin = new Float32Array(this.onsetAnalyser.frequencyBinCount);
      this.curOnsetLin = new Float32Array(this.onsetAnalyser.frequencyBinCount);
      this.specDb = new Float32Array(bins);
      this.specLin = new Float32Array(bins);
      this.ring = Array.from({ length: PRE_SNAPSHOT_TICKS + 1 }, () => new Float32Array(bins));
      this.ringAt = 0;

      this.fluxMean = 0;
      this.fluxDev = 0;
      this.noiseFloorRms = 0.001;
      this.level = 0;
      this.lastOnsetAt = -Infinity;
      this.armed = true;
      this.onsetFluxPeak = 0;
      this.lastOnsetFluxPeak = 0;
      this.attackBandEma = 0;
      this.pending = [];

      this.intervalId = window.setInterval(() => this.tick(), PLUCK_INTERVAL_MS);
      this.setState('listening');
    } catch (err) {
      this.teardown();
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this._error = 'Microphone permission denied';
        this.setState('denied');
      } else {
        this._error = err instanceof Error ? err.message : 'Could not open microphone';
        this.setState('error');
      }
    }
  }

  stop(): void {
    this.teardown();
    if (this._state !== 'idle') this.setState('idle');
  }

  private teardown(): void {
    if (this.intervalId != null) { window.clearInterval(this.intervalId); this.intervalId = null; }
    this.source?.disconnect();
    this.source = null;
    this.hpFilter?.disconnect();
    this.hpFilter = null;
    this.lpFilter?.disconnect();
    this.lpFilter = null;
    this.rawAnalyser?.disconnect();
    this.rawAnalyser = null;
    this.onsetAnalyser = null;
    this.specAnalyser = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.pending = [];
    this.ring = [];
    this.level = 0;
  }

  private setState(s: ListenerState): void {
    this._state = s;
    this.stateCbs.forEach(cb => cb(s));
  }

  // --- analysis --------------------------------------------------------------

  private tick(): void {
    const onset = this.onsetAnalyser, spec = this.specAnalyser, ctx = this.ctx;
    if (!onset || !spec || !ctx) return;
    const now = performance.now();
    const sampleRate = ctx.sampleRate;

    onset.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i];
    const rms = Math.sqrt(sum / this.timeBuf.length);
    this.level += (rms - this.level) * LEVEL_EMA_ALPHA;
    const floorAlpha = rms < this.noiseFloorRms ? NOISE_FLOOR_FALL_ALPHA : NOISE_FLOOR_RISE_ALPHA;
    this.noiseFloorRms += (rms - this.noiseFloorRms) * floorAlpha;

    // Half-wave-rectified spectral flux, exactly as the chord engine does it.
    onset.getFloatFrequencyData(this.onsetSpec);
    const onsetHzPerBin = sampleRate / ONSET_FFT_SIZE;
    const kLo = Math.max(1, Math.floor(FLUX_LOW_HZ / onsetHzPerBin));
    const kHi = Math.min(this.onsetSpec.length - 1, Math.floor(FLUX_HIGH_HZ / onsetHzPerBin));
    let flux = 0;
    let attackBand = 0;
    const aLo = Math.max(1, Math.floor(ATTACK_BAND_LOW_HZ / onsetHzPerBin));
    const aHi = Math.min(this.onsetSpec.length - 1, Math.floor(ATTACK_BAND_HIGH_HZ / onsetHzPerBin));
    for (let k = kLo; k <= kHi; k++) {
      const lin = Math.pow(10, this.onsetSpec[k] / 20);
      this.curOnsetLin[k] = lin;
      const d = lin - this.prevOnsetLin[k];
      if (d > 0) flux += d;
      if (k >= aLo && k <= aHi) attackBand += lin;
    }
    // Compare against the band's level BEFORE this frame, then fold this frame in.
    const attackRatio = this.attackBandEma > 0 ? attackBand / this.attackBandEma : 999;
    this.attackBandEma += (attackBand - this.attackBandEma) * ATTACK_BAND_ALPHA;
    const swap = this.prevOnsetLin;
    this.prevOnsetLin = this.curOnsetLin;
    this.curOnsetLin = swap;

    // Spectrum snapshot into the ring BEFORE any onset is finalized, so an onset
    // firing this tick reads a strictly older frame as its "before".
    spec.getFloatFrequencyData(this.specDb);
    for (let k = 0; k < this.specDb.length; k++) this.specLin[k] = Math.pow(10, this.specDb[k] / 20);
    const preFrame = this.ring[(this.ringAt + 1) % this.ring.length]; // oldest
    const slot = this.ring[this.ringAt];
    slot.set(this.specLin);
    this.ringAt = (this.ringAt + 1) % this.ring.length;

    const threshold = this.fluxMean + FLUX_THRESHOLD_K * this.fluxDev;
    const gate = Math.max(this.userGateRms, MIN_RMS_ABS, NOISE_GATE_RATIO * this.noiseFloorRms);
    if (!this.armed) {
      if (flux > this.onsetFluxPeak) this.onsetFluxPeak = flux;
      if (flux < ONSET_REARM_RATIO * this.onsetFluxPeak) this.armed = true;
    }
    const sinceLast = now - this.lastOnsetAt;
    const echoOk = sinceLast > ONSET_ECHO_WINDOW_MS
      || flux >= ONSET_MIN_ECHO_FLUX * this.lastOnsetFluxPeak;
    const isOnset = this.armed && flux > threshold && rms > gate
      && sinceLast > ONSET_REFRACTORY_MS && this.fluxDev > 0 && echoOk;

    if (isOnset) {
      this.armed = false;
      this.lastOnsetFluxPeak = this.onsetFluxPeak;
      this.onsetFluxPeak = flux;
      const at = this.refineOnsetTime(now, sampleRate);
      this.lastOnsetAt = now;
      // A new attack ends any still-open window: whatever we have of the old
      // pick is better than a window contaminated by the new one.
      this.pending.forEach(p => this.finalize(p, sampleRate));
      this.pending = [{
        at,
        pre: Float32Array.from(preFrame),
        attackRatio,
        accum: new Float32Array(this.specLin.length),
        frames: 0,
        rmsPeak: rms,
      }];
    }

    const d = flux - this.fluxMean;
    this.fluxMean += FLUX_EMA_ALPHA * d;
    this.fluxDev += FLUX_EMA_ALPHA * (Math.abs(d) - this.fluxDev);

    const done: PendingOnset[] = [];
    for (const p of this.pending) {
      const age = now - p.at;
      if (age >= POST_ONSET_START_MS && age <= POST_ONSET_END_MS) {
        for (let k = 0; k < this.specLin.length; k++) p.accum[k] += this.specLin[k];
        p.frames++;
        if (rms > p.rmsPeak) p.rmsPeak = rms;
      }
      if (age > POST_ONSET_END_MS) done.push(p);
    }
    if (done.length) {
      this.pending = this.pending.filter(p => !done.includes(p));
      done.forEach(p => this.finalize(p, sampleRate));
    }
  }

  /**
   * Back-date the onset from the tick time to the actual attack, by finding
   * where the envelope rises inside the time-domain buffer we just read. The
   * buffer's last sample is ~`now`, so the attack is `(len - i)` samples ago.
   *
   * This is the difference between a timing-evenness score that measures the
   * player and one that measures our 10 ms polling grid.
   */
  private refineOnsetTime(now: number, sampleRate: number): number {
    const buf = this.timeBuf;
    const n = buf.length;
    if (n < ENVELOPE_WIN * 2) return now;
    const wins = Math.floor(n / ENVELOPE_WIN);
    let peak = 0;
    const env = new Float32Array(wins);
    for (let w = 0; w < wins; w++) {
      let s = 0;
      for (let i = w * ENVELOPE_WIN; i < (w + 1) * ENVELOPE_WIN; i++) s += buf[i] * buf[i];
      env[w] = Math.sqrt(s / ENVELOPE_WIN);
      if (env[w] > peak) peak = env[w];
    }
    if (peak <= 0) return now;
    // The steepest RISE, not the first crossing of a level: with the previous
    // string still ringing the whole buffer sits above any absolute level, and
    // a first-crossing search would always answer "the start of the buffer".
    let rise = -1;
    let bestJump = ENVELOPE_RISE_FRACTION * peak;
    for (let w = 1; w < wins; w++) {
      const jump = env[w] - env[w - 1];
      if (jump > bestJump) { bestJump = jump; rise = w; }
    }
    if (rise < 0) return now;
    const samplesAgo = n - rise * ENVELOPE_WIN;
    return now - (samplesAgo / sampleRate) * 1000;
  }

  private finalize(p: PendingOnset, sampleRate: number): void {
    if (p.frames === 0) return;
    const delta = new Float32Array(p.accum.length);
    for (let k = 0; k < delta.length; k++) {
      const post = p.accum[k] / p.frames;
      delta[k] = Math.max(0, post - p.pre[k]);
    }
    const r = scorePlucks(delta, sampleRate, PLUCK_FFT_SIZE, this.candidates,
      { pre: p.pre });
    const top = r.ranked[0];
    const event: PluckEvent = {
      at: p.at,
      stringIndex: r.best,
      midi: r.best != null && top ? top.midi : null,
      ranked: r.ranked,
      margin: r.margin,
      strength: r.strength,
      newness: r.newness,
      attackRatio: p.attackRatio,
      isNew: r.isNew,
      ambiguous: r.ambiguous,
      delta,
      level: p.rmsPeak,
    };
    this.pluckCbs.forEach(cb => cb(event));
  }
}
