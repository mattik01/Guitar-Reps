// Microphone chord listener — the engine behind mic-assisted routines.
//
// Framework-free on purpose: React sees only low-frequency events (strums,
// knocks, state changes) through subscriptions; the 40 Hz analysis loop and all
// buffers live here. One MediaStreamSource feeds two analysers:
//
//   onsetAnalyser  (fftSize 2048, ~43 ms window)  → spectral flux → onsets
//   chromaAnalyser (fftSize 8192, ~5.9 Hz bins)   → pitch-class folding → chroma
//
// Each onset gets a post-onset chroma window (40–220 ms after the hit, skipping
// the broadband pick transient). Tonal onsets (≥3 active pitch classes) are
// strums and get matched against the registered target templates; percussive
// onsets (a knock on the guitar body, a click, a single pluck) become knock
// events, with double-knock pairing done here.
//
// All thresholds are adaptive/relative where possible — absolute mic levels
// vary wildly across hardware. Tune constants via the /mic-test page.

import type { ChordShape } from '../state/store';
import { soundingPitchClasses } from '../data/validateChords';
import {
  MIN_ACTIVE_PITCH_CLASSES,
  SWAP_CLASSIFY_MARGIN,
  activePitchClassCount,
  chordTemplate,
  computeCleanliness,
  cosineSim,
  foldSpectrumToChroma,
  l2Normalize,
  verdictForSimilarity,
  type Cleanliness,
  type Verdict,
} from './chroma';

export type ListenerState = 'idle' | 'starting' | 'listening' | 'denied' | 'error';

export type StrumEvent = {
  at: number; // performance.now() of the onset
  chroma: Float32Array; // 12-dim, unit norm, averaged post-onset window
  // Per target, sorted by score desc. `similarity` is the raw cosine; `score`
  // is similarity normalized by the target's typical calibrated level (equals
  // similarity when uncalibrated) — ranking and confidence use the score.
  matches: { id: string; similarity: number; score: number }[];
  best: string | null; // top target id, or null when top two are within margin
  verdict: Verdict; // absolute-threshold verdict vs the top target
  // Heuristic 0–100 cleanliness vs the top-matching target (null without
  // targets). Purely informational — never used to gate detection.
  cleanliness: Cleanliness | null;
  // classification diagnostics (shown on /mic-test for tuning)
  sustain: number; // rmsEnd / rmsPeak of the post-onset window
  activePc: number; // active pitch classes in the window chroma
};

export type KnockEvent = { at: number };

// ---- loop & onset tuning ----------------------------------------------------
const ANALYSIS_INTERVAL_MS = 25;
const ONSET_FFT_SIZE = 2048;
const CHROMA_FFT_SIZE = 8192;
const FLUX_LOW_HZ = 80;
const FLUX_HIGH_HZ = 5000;
const FLUX_THRESHOLD_K = 3.0; // onset when flux > mean + K·deviation
const FLUX_EMA_ALPHA = 0.05; // ~0.5 s time constant at 40 Hz
const MIN_RMS_ABS = 0.004; // ≈ -48 dBFS hard floor
const NOISE_GATE_RATIO = 3; // …or 3× the ambient noise floor
// The floor must track the MINIMUM ambient level, not the recent average —
// otherwise a ringing chord inflates it and the raised gate swallows the next
// strum/knock. Asymmetric EMA: falls fast in silence, barely rises with signal.
const NOISE_FLOOR_FALL_ALPHA = 0.1;
const NOISE_FLOOR_RISE_ALPHA = 0.001;
const ONSET_REFRACTORY_MS = 80; // global — short, so fast double-knocks survive
const STRUM_DEBOUNCE_MS = 250; // strum-to-strum — caps at 4 strums/s
const POST_ONSET_START_MS = 40; // skip the broadband pick/knock transient
const POST_ONSET_END_MS = 220;
const DOUBLE_KNOCK_MIN_MS = 80;
const DOUBLE_KNOCK_MAX_MS = 600;
// Knocks need their own, stricter loudness gate: quiet room-noise blips pass
// the onset gate and would otherwise register as phantom knocks. Relative to
// the noise floor (hardware-independent); does not affect strum sensitivity.
const KNOCK_PEAK_RATIO = 6;
const KNOCK_MIN_RMS_ABS = 0.008;
// Buzz/rattle band for the cleanliness tonality measure: fret buzz is
// broadband and lives mostly ABOVE the chroma range (which caps at 1.2 kHz),
// while a clean chord's energy up there decays quickly after the attack.
const BUZZ_BAND_LOW_HZ = 1500;
const BUZZ_BAND_HIGH_HZ = 5000;
// How strongly buzz-band energy counts against tonality (clean guitars do put
// SOME harmonic energy up there, so it's discounted rather than fully counted).
const BUZZ_BAND_WEIGHT = 0.7;
// The between-note and buzz-band sums integrate ambient noise over hundreds of
// FFT bins, so the room's baseline must be subtracted before they mean
// anything. Min-tracking floors, like the RMS noise floor.
const BAND_FLOOR_FALL_ALPHA = 0.1;
const BAND_FLOOR_RISE_ALPHA = 0.005;
const LEVEL_EMA_ALPHA = 0.3;
// Optional "Filters" front-end (Tier-1 DSP): a steep high-pass kills sub-bass
// rumble / HVAC / handling thumps below the low-E fundamental (E2 ≈ 82 Hz), and
// a gentle low-pass trims hiss above the guitar's useful harmonics. Chroma
// folding already ignores <90 Hz, so this mainly cleans the RMS/level + noise-
// floor + flux paths without touching the pitched content.
const FILTER_HP_HZ = 75;
const FILTER_HP_Q = 0.707; // Butterworth — no resonant peak near low E
const FILTER_LP_HZ = 7000;
// A strummed chord still rings at the end of the post-onset window; a knock on
// the body (or a muted scratch) has decayed. Percussive = end RMS below this
// fraction of the window's peak RMS. Relative, so hardware-independent.
const KNOCK_SUSTAIN_RATIO = 0.25;

export type TargetInput = {
  id: string;
  shape: ChordShape;
  // Per-chord calibrated verdict thresholds (see calibratedThresholds); the
  // global QUIZ_* constants apply when absent.
  matchThreshold?: number;
  unsureThreshold?: number;
  // Typical calibrated similarity (see typicalSimilarity) — normalizes A-vs-B
  // ranking so flat-template chords aren't structurally outscored.
  typicalSim?: number;
};
type Target = TargetInput & { template: Float32Array; expectedPcs: number[] };
type PendingOnset = {
  at: number;
  accum: Float32Array;
  frames: number;
  rmsPeak: number;
  rmsEnd: number;
  // note-bin vs (between-note + buzz-band) energy over the window — the
  // tonality (buzz/rattle) measure
  toneAccum: number;
  noiseAccum: number;
};

export class ChordListener {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onsetAnalyser: AnalyserNode | null = null;
  private chromaAnalyser: AnalyserNode | null = null;
  private rawAnalyser: AnalyserNode | null = null; // pre-filter, for the spectrum viz
  private rawSpec = new Float32Array(0);
  private hpFilter: BiquadFilterNode | null = null;
  private lpFilter: BiquadFilterNode | null = null;
  private filtersEnabled = false; // user "Filters" toggle; reroutes the graph
  private filterHpHz = FILTER_HP_HZ;  // tunable cutoffs (setFilterParams)
  private filterLpHz = FILTER_LP_HZ;
  private intervalId: number | null = null;

  private targets: Target[] = [];

  private strumCbs = new Set<(e: StrumEvent) => void>();
  private knockCbs = new Set<(e: KnockEvent) => void>();
  private doubleKnockCbs = new Set<(e: KnockEvent) => void>();
  private stateCbs = new Set<(s: ListenerState) => void>();

  private _state: ListenerState = 'idle';
  private _error: string | null = null;

  // analysis buffers (allocated on start)
  private timeBuf = new Float32Array(0);
  private onsetSpec = new Float32Array(0);
  private prevOnsetLin = new Float32Array(0);
  private curOnsetLin = new Float32Array(0);
  private chromaSpec = new Float32Array(0);
  private liveChroma: Float32Array = new Float32Array(12);

  // adaptive stats
  private fluxMean = 0;
  private fluxDev = 0;
  private noiseFloorRms = 0.001;
  private userGateRms = 0; // user activation threshold as a linear-RMS floor; 0 = off
  private betweenFloor = -1; // -1 = uninitialized; first frame sets it directly
  private buzzFloor = -1;
  private level = 0;
  private lastOnsetAt = -Infinity;
  private lastStrumAt = -Infinity;
  private lastKnockAt = -Infinity;
  private pending: PendingOnset[] = [];

  get state(): ListenerState { return this._state; }
  get error(): string | null { return this._error; }

  onStrum(cb: (e: StrumEvent) => void): () => void {
    this.strumCbs.add(cb);
    return () => this.strumCbs.delete(cb);
  }
  onKnock(cb: (e: KnockEvent) => void): () => void {
    this.knockCbs.add(cb);
    return () => this.knockCbs.delete(cb);
  }
  onDoubleKnock(cb: (e: KnockEvent) => void): () => void {
    this.doubleKnockCbs.add(cb);
    return () => this.doubleKnockCbs.delete(cb);
  }
  onStateChange(cb: (s: ListenerState) => void): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  setTargets(targets: TargetInput[]): void {
    this.targets = targets.map(t => ({
      ...t,
      template: chordTemplate(t.shape),
      expectedPcs: [...new Set(soundingPitchClasses(t.shape))],
    }));
  }

  /** Smoothed input level, 0..1 (log-mapped, -60 dBFS → 0). For meters; poll it. */
  getLevel(): number {
    if (this.level <= 0) return 0;
    return Math.min(1, Math.max(0, (20 * Math.log10(this.level) + 60) / 60));
  }

  /**
   * User "activation threshold" (Discord-style noise gate), given on the same
   * 0..1 log scale getLevel() returns. Inverts that mapping to a linear-RMS
   * floor folded into both event gates. 0 = off. Only ever RAISES the floor
   * (via Math.max), so it can't defeat the adaptive noise gate.
   */
  setMinLevel(level01: number): void {
    this.userGateRms = level01 <= 0 ? 0 : Math.pow(10, 3 * (level01 - 1));
  }

  /** Toggle the Tier-1 DSP front-end (high-pass + low-pass). Reroutes live. */
  setFilters(enabled: boolean): void {
    if (enabled === this.filtersEnabled) return;
    this.filtersEnabled = enabled;
    if (this.ctx) this.applyRouting();
  }

  /** Tune the filter cutoffs (Hz). Applied to the live biquads immediately. */
  setFilterParams(hpHz: number, lpHz: number): void {
    this.filterHpHz = Math.max(20, Math.min(300, hpHz || FILTER_HP_HZ));
    this.filterLpHz = Math.max(this.filterHpHz + 500, Math.min(16000, lpHz || FILTER_LP_HZ));
    if (this.hpFilter) this.hpFilter.frequency.value = this.filterHpHz;
    if (this.lpFilter) this.lpFilter.frequency.value = this.filterLpHz;
  }

  // (Re)connect source → [HP → LP] → both analysers depending on filtersEnabled.
  private applyRouting(): void {
    const src = this.source, hp = this.hpFilter, lp = this.lpFilter;
    const onset = this.onsetAnalyser, chroma = this.chromaAnalyser;
    if (!src || !hp || !lp || !onset || !chroma) return;
    src.disconnect();
    hp.disconnect();
    lp.disconnect();
    if (this.filtersEnabled) {
      src.connect(hp);
      hp.connect(lp);
      lp.connect(onset);
      lp.connect(chroma);
    } else {
      src.connect(onset);
      src.connect(chroma);
    }
    // Raw tap is ALWAYS pre-filter (src.disconnect() above dropped it too).
    if (this.rawAnalyser) src.connect(this.rawAnalyser);
  }

  /** Live (non-onset) chroma snapshot, unit norm. For debug visualization. */
  getLiveChroma(): Float32Array {
    return this.liveChroma;
  }

  /** Live magnitude spectrum (dB per bin) from the RAW pre-filter tap — so the
   *  filter tuning UI can show the rumble/hiss you're deciding whether to cut,
   *  independent of whether the filter is currently on. */
  getSpectrum(): Float32Array {
    if (this.rawAnalyser) this.rawAnalyser.getFloatFrequencyData(this.rawSpec);
    return this.rawSpec;
  }

  /** Sample rate + FFT size needed to map spectrum bins → Hz. */
  getSpectrumMeta(): { sampleRate: number; fftSize: number } {
    return {
      sampleRate: this.ctx?.sampleRate ?? 44100,
      fftSize: this.rawAnalyser?.fftSize ?? CHROMA_FFT_SIZE,
    };
  }

  async start(): Promise<void> {
    if (this._state === 'listening' || this._state === 'starting') return;
    this.setState('starting');
    try {
      // Speech processing is tuned for voice and actively harms guitar:
      // AGC flattens the very dynamics we detect onsets from, echo cancellation
      // and noise suppression eat sustained harmonic content.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      await this.ctx.resume(); // covered by the click that led here

      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.onsetAnalyser = this.ctx.createAnalyser();
      this.onsetAnalyser.fftSize = ONSET_FFT_SIZE;
      this.onsetAnalyser.smoothingTimeConstant = 0; // we average ourselves
      this.chromaAnalyser = this.ctx.createAnalyser();
      this.chromaAnalyser.fftSize = CHROMA_FFT_SIZE;
      this.chromaAnalyser.smoothingTimeConstant = 0;
      this.hpFilter = this.ctx.createBiquadFilter();
      this.hpFilter.type = 'highpass';
      this.hpFilter.frequency.value = this.filterHpHz;
      this.hpFilter.Q.value = FILTER_HP_Q;
      this.lpFilter = this.ctx.createBiquadFilter();
      this.lpFilter.type = 'lowpass';
      this.lpFilter.frequency.value = this.filterLpHz;
      this.rawAnalyser = this.ctx.createAnalyser();
      this.rawAnalyser.fftSize = CHROMA_FFT_SIZE;
      this.rawAnalyser.smoothingTimeConstant = 0;
      this.rawSpec = new Float32Array(this.rawAnalyser.frequencyBinCount);
      this.applyRouting(); // wires source → [HP→LP] → analysers per filtersEnabled

      this.timeBuf = new Float32Array(ONSET_FFT_SIZE);
      this.onsetSpec = new Float32Array(this.onsetAnalyser.frequencyBinCount);
      this.prevOnsetLin = new Float32Array(this.onsetAnalyser.frequencyBinCount);
      this.curOnsetLin = new Float32Array(this.onsetAnalyser.frequencyBinCount);
      this.chromaSpec = new Float32Array(this.chromaAnalyser.frequencyBinCount);

      this.fluxMean = 0;
      this.fluxDev = 0;
      this.noiseFloorRms = 0.001;
      this.betweenFloor = -1;
      this.buzzFloor = -1;
      this.lastOnsetAt = this.lastStrumAt = this.lastKnockAt = -Infinity;
      this.pending = [];

      this.intervalId = window.setInterval(() => this.tick(), ANALYSIS_INTERVAL_MS);
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
    this.chromaAnalyser = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.pending = [];
    this.level = 0;
  }

  private setState(s: ListenerState): void {
    this._state = s;
    if (s === 'listening' || s === 'starting') this._error = null;
    this.stateCbs.forEach(cb => cb(s));
  }

  private tick(): void {
    const onset = this.onsetAnalyser, chroma = this.chromaAnalyser, ctx = this.ctx;
    if (!onset || !chroma || !ctx) return;
    const now = performance.now();
    const sr = ctx.sampleRate;

    // 1. Input level (time domain RMS)
    onset.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i];
    const rms = Math.sqrt(sum / this.timeBuf.length);
    this.level += LEVEL_EMA_ALPHA * (rms - this.level);
    this.noiseFloorRms += (rms < this.noiseFloorRms ? NOISE_FLOOR_FALL_ALPHA : NOISE_FLOOR_RISE_ALPHA) * (rms - this.noiseFloorRms);

    // 2. Spectral flux on the fast analyser
    onset.getFloatFrequencyData(this.onsetSpec);
    const hzPerBin = sr / ONSET_FFT_SIZE;
    const kLo = Math.max(1, Math.floor(FLUX_LOW_HZ / hzPerBin));
    const kHi = Math.min(this.onsetSpec.length - 1, Math.ceil(FLUX_HIGH_HZ / hzPerBin));
    let flux = 0;
    for (let k = kLo; k <= kHi; k++) {
      const lin = Math.pow(10, this.onsetSpec[k] / 20);
      this.curOnsetLin[k] = lin;
      const d = lin - this.prevOnsetLin[k];
      if (d > 0) flux += d;
    }
    // swap cur/prev without allocating
    const tmp = this.prevOnsetLin; this.prevOnsetLin = this.curOnsetLin; this.curOnsetLin = tmp;

    // 3. Adaptive onset decision (relative — absolute levels differ per mic)
    const threshold = this.fluxMean + FLUX_THRESHOLD_K * this.fluxDev;
    const gate = Math.max(this.userGateRms, MIN_RMS_ABS, NOISE_GATE_RATIO * this.noiseFloorRms);
    const isOnset = flux > threshold && rms > gate && now - this.lastOnsetAt > ONSET_REFRACTORY_MS
      && this.fluxDev > 0; // never fire on the very first frames
    this.fluxMean += FLUX_EMA_ALPHA * (flux - this.fluxMean);
    this.fluxDev += FLUX_EMA_ALPHA * (Math.abs(flux - this.fluxMean) - this.fluxDev);
    if (isOnset) {
      // Close any still-open windows NOW, before this onset's energy leaks into
      // them — a second knock landing inside the first knock's window would make
      // the first look "sustained" and misread as a strum. Their rmsEnd is from
      // the previous tick, i.e. genuinely pre-onset.
      for (const p of this.pending) this.finalizeOnset(p);
      this.pending.length = 0;
      this.lastOnsetAt = now;
      this.pending.push({
        at: now, accum: new Float32Array(12), frames: 0,
        rmsPeak: rms, rmsEnd: rms, toneAccum: 0, noiseAccum: 0,
      });
    }

    // 4. Chroma folding — live view + pending post-onset windows
    chroma.getFloatFrequencyData(this.chromaSpec);
    const frame = new Float32Array(12);
    const betweenEnergy = foldSpectrumToChroma(this.chromaSpec, sr, CHROMA_FFT_SIZE, frame);
    let frameEnergy = 0;
    for (let pc = 0; pc < 12; pc++) frameEnergy += frame[pc];
    // Buzz-band energy (above the chroma range) — sustained content up here
    // after the attack is the signature of fret buzz/rattle.
    const hzPerChromaBin = sr / CHROMA_FFT_SIZE;
    const bLo = Math.max(1, Math.ceil(BUZZ_BAND_LOW_HZ / hzPerChromaBin));
    const bHi = Math.min(this.chromaSpec.length - 1, Math.floor(BUZZ_BAND_HIGH_HZ / hzPerChromaBin));
    let buzzEnergy = 0;
    for (let k = bLo; k <= bHi; k++) buzzEnergy += Math.pow(10, this.chromaSpec[k] / 20);
    // Ambient floors for both bands (min-tracking: fall fast, rise slowly).
    if (this.betweenFloor < 0) { this.betweenFloor = betweenEnergy; this.buzzFloor = buzzEnergy; }
    this.betweenFloor += (betweenEnergy < this.betweenFloor ? BAND_FLOOR_FALL_ALPHA : BAND_FLOOR_RISE_ALPHA) * (betweenEnergy - this.betweenFloor);
    this.buzzFloor += (buzzEnergy < this.buzzFloor ? BAND_FLOOR_FALL_ALPHA : BAND_FLOOR_RISE_ALPHA) * (buzzEnergy - this.buzzFloor);
    const betweenExcess = Math.max(0, betweenEnergy - this.betweenFloor);
    const buzzExcess = Math.max(0, buzzEnergy - this.buzzFloor);
    this.liveChroma = l2Normalize(frame.slice());
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      const age = now - p.at;
      if (age <= POST_ONSET_END_MS) {
        if (rms > p.rmsPeak) p.rmsPeak = rms;
        p.rmsEnd = rms;
        if (age >= POST_ONSET_START_MS) {
          for (let pc = 0; pc < 12; pc++) p.accum[pc] += frame[pc];
          p.toneAccum += frameEnergy;
          p.noiseAccum += betweenExcess + BUZZ_BAND_WEIGHT * buzzExcess;
          p.frames++;
        }
      } else {
        this.pending.splice(i, 1);
        this.finalizeOnset(p);
      }
    }
  }

  private finalizeOnset(p: PendingOnset): void {
    if (p.frames === 0) return;
    const chroma = l2Normalize(p.accum);
    const sustain = p.rmsPeak > 0 ? p.rmsEnd / p.rmsPeak : 0;
    const activePc = activePitchClassCount(chroma);

    // Percussive vs tonal: too few pitch classes (single pluck, click) OR fast
    // decay (a knock is gone by the end of the window; a chord still rings —
    // a knock's broadband transient can light up many chroma bins, so the
    // pitch-class test alone would misread it as a weak strum).
    const percussive = activePc < MIN_ACTIVE_PITCH_CLASSES || sustain < KNOCK_SUSTAIN_RATIO;
    if (percussive) {
      // Percussive/non-chordal: a knock on the body, a click, a single pluck.
      // A real knock is LOUD — drop quiet blips (room noise, distant taps).
      if (p.rmsPeak < Math.max(this.userGateRms, KNOCK_MIN_RMS_ABS, KNOCK_PEAK_RATIO * this.noiseFloorRms)) return;
      const e: KnockEvent = { at: p.at };
      this.knockCbs.forEach(cb => cb(e));
      const gap = p.at - this.lastKnockAt;
      if (gap >= DOUBLE_KNOCK_MIN_MS && gap <= DOUBLE_KNOCK_MAX_MS) {
        this.lastKnockAt = -Infinity; // a triple knock is not two doubles
        this.doubleKnockCbs.forEach(cb => cb(e));
      } else {
        this.lastKnockAt = p.at;
      }
      return;
    }

    // Tonal onset = strum, with its own slower debounce.
    if (p.at - this.lastStrumAt < STRUM_DEBOUNCE_MS) return;
    this.lastStrumAt = p.at;

    const matches = this.targets
      .map(t => {
        const similarity = cosineSim(chroma, t.template);
        return { id: t.id, similarity, score: t.typicalSim ? similarity / t.typicalSim : similarity };
      })
      .sort((a, b) => b.score - a.score);
    const confident = matches.length < 2 || matches[0].score - matches[1].score > SWAP_CLASSIFY_MARGIN;
    const topTarget = matches.length > 0 ? this.targets.find(t => t.id === matches[0].id) : undefined;
    const tonality = p.toneAccum + p.noiseAccum > 0 ? p.toneAccum / (p.toneAccum + p.noiseAccum) : 0;
    const e: StrumEvent = {
      at: p.at,
      chroma,
      matches,
      best: matches.length > 0 && confident ? matches[0].id : null,
      verdict: matches.length > 0
        ? verdictForSimilarity(matches[0].similarity, topTarget?.matchThreshold, topTarget?.unsureThreshold)
        : 'unsure',
      cleanliness: topTarget
        ? computeCleanliness(chroma, topTarget.expectedPcs, topTarget.template, tonality, sustain)
        : null,
      sustain,
      activePc,
    };
    this.strumCbs.forEach(cb => cb(e));
  }
}
