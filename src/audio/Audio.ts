// Web Audio で合成する環境音・BGM・効果音。音声ファイルは使わない。

type Mood = 'title' | 'work' | 'tense' | 'ending' | 'none';

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// 和音（MIDI ノート）：Am9 - Fmaj7 - Cmaj7/G - E7sus4
const PROG = [
  [45, 57, 60, 64, 71],
  [41, 57, 60, 64, 69],
  [43, 55, 59, 64, 67],
  [40, 56, 59, 62, 64],
];
const PROG_TENSE = [
  [45, 57, 60, 63, 66],
  [44, 56, 59, 62, 65],
  [45, 57, 60, 63, 66],
  [41, 57, 60, 63, 68],
];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private noise!: AudioBuffer;
  private delay!: DelayNode;
  private delayFb!: GainNode;
  private mood: Mood = 'none';
  private nextBeat = 0;
  private beat = 0;
  private timer: number | null = null;
  private sizzleGain: GainNode | null = null;
  private chillGain: GainNode | null = null;
  private vol = { master: 0.8, music: 0.55, sfx: 0.8 };
  muted = false;

  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);
    // 音楽用のディレイ
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.36;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2200;
    this.delay.connect(dlp);
    dlp.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    dlp.connect(this.musicBus);
    // ノイズ素材
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startAmbience();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.sfx * 0.55, t, 0.1);
  }

  // ───────── 基本部品 ─────────

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, dest: AudioNode, opts: { to?: number; a?: number; detune?: number } = {}): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    this.env(g, t, opts.a ?? 0.005, peak, dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + (opts.a ?? 0.005) + dur + 0.05);
    return o;
  }

  private noiseBurst(t: number, dur: number, peak: number, filter: BiquadFilterType, freq: number, dest: AudioNode, opts: { q?: number; to?: number; a?: number } = {}): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    this.env(g, t, opts.a ?? 0.005, peak, dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + (opts.a ?? 0.005) + dur + 0.05);
  }

  private get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ───────── 環境音 ─────────

  private startAmbience(): void {
    const ctx = this.ctx!;
    // 厨房の低い唸り
    for (const [f, v] of [
      [55, 0.05],
      [110, 0.025],
      [165, 0.01],
    ] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.value = v;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13 + Math.random() * 0.1;
      const lg = ctx.createGain();
      lg.gain.value = v * 0.4;
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.ambBus);
      o.start();
      lfo.start();
    }
    // 雨
    const rain = ctx.createBufferSource();
    rain.buffer = this.noise;
    rain.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 1400;
    rf.Q.value = 0.4;
    const rg = ctx.createGain();
    rg.gain.value = 0.06;
    rain.connect(rf);
    rf.connect(rg);
    rg.connect(this.ambBus);
    rain.start();
    // 食堂のざわめき（こもった声の帯域をゆらす）
    const crowd = ctx.createBufferSource();
    crowd.buffer = this.noise;
    crowd.loop = true;
    crowd.playbackRate.value = 0.5;
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 520;
    cf.Q.value = 2.5;
    const cg = ctx.createGain();
    cg.gain.value = 0.035;
    const clfo = ctx.createOscillator();
    clfo.frequency.value = 0.7;
    const clg = ctx.createGain();
    clg.gain.value = 180;
    clfo.connect(clg);
    clg.connect(cf.frequency);
    crowd.connect(cf);
    cf.connect(cg);
    cg.connect(this.ambBus);
    crowd.start();
    clfo.start();
    // 加熱・冷却のループ（ふだんは無音）
    const mkLoop = (type: BiquadFilterType, f: number, q: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const fl = ctx.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(fl);
      fl.connect(g);
      g.connect(this.sfxBus);
      s.start();
      return g;
    };
    this.sizzleGain = mkLoop('highpass', 3200, 0.7);
    this.chillGain = mkLoop('bandpass', 1800, 3);
  }

  /** 加熱（+）／冷却（-）の音量 */
  setHeatSound(dir: number, temp: number): void {
    if (!this.ctx || !this.sizzleGain || !this.chillGain) return;
    const t = this.now;
    const sz = dir > 0 ? 0.08 + Math.max(0, temp) * 0.1 : 0;
    const ch = dir < 0 ? 0.07 + Math.max(0, -temp) * 0.08 : 0;
    this.sizzleGain.gain.setTargetAtTime(sz * (0.75 + Math.random() * 0.5), t, 0.03);
    this.chillGain.gain.setTargetAtTime(ch, t, 0.08);
    if (dir > 0 && Math.random() < 0.3) this.noiseBurst(t, 0.03, 0.05 + Math.random() * 0.05, 'highpass', 4000, this.sfxBus);
  }

  // ───────── BGM ─────────

  setMood(m: Mood): void {
    if (m === this.mood) return;
    this.mood = m;
    if (this.ctx) this.nextBeat = Math.max(this.nextBeat, this.ctx.currentTime + 0.05);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.mood === 'none') return;
    const bpm = this.mood === 'title' ? 68 : this.mood === 'ending' ? 60 : this.mood === 'tense' ? 96 : 84;
    const spb = 60 / bpm / 2; // 8 分音符
    while (this.nextBeat < ctx.currentTime + 0.12) {
      this.playStep(this.nextBeat, this.beat, spb);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  private playStep(t: number, step: number, spb: number): void {
    const m = this.mood;
    const bar = Math.floor(step / 8);
    const prog = m === 'tense' ? PROG_TENSE : PROG;
    const chord = prog[Math.floor(bar / 2) % prog.length];
    const inBar = step % 8;
    const bus = this.musicBus;
    // パッド（2 小節ごと）
    if (step % 16 === 0) {
      const dur = spb * 16;
      for (let i = 1; i < chord.length; i++) {
        for (const det of [-7, 7]) {
          const o = this.ctx!.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = NOTE(chord[i]);
          o.detune.value = det;
          const lp = this.ctx!.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(500, t);
          lp.frequency.linearRampToValueAtTime(m === 'tense' ? 1400 : 900, t + dur * 0.5);
          lp.frequency.linearRampToValueAtTime(500, t + dur);
          const g = this.ctx!.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.018, t + 1.2);
          g.gain.setValueAtTime(0.018, t + dur - 1.2);
          g.gain.linearRampToValueAtTime(0.0001, t + dur);
          o.connect(lp);
          lp.connect(g);
          g.connect(bus);
          o.start(t);
          o.stop(t + dur + 0.1);
        }
      }
    }
    if (m === 'title' || m === 'ending') {
      // まばらなアルペジオ
      if (inBar % 3 === 0) {
        const n = chord[1 + ((step * 7) % (chord.length - 1))] + 12;
        this.pluck(t, NOTE(n), 0.05, 1.2);
      }
      if (step % 16 === 0) this.osc('sine', NOTE(chord[0] - 12), t, spb * 14, 0.08, bus, { a: 0.4 });
      return;
    }
    // ベース
    if (inBar === 0 || inBar === 4 || (m === 'tense' && inBar % 2 === 0)) {
      this.osc('triangle', NOTE(chord[0] - 12), t, spb * 1.6, 0.13, bus);
    }
    // キック
    if (inBar === 0 || inBar === 4) {
      this.osc('sine', 120, t, 0.18, 0.28, bus, { to: 45 });
    }
    // ハイハット
    if (inBar % 2 === 1) this.noiseBurst(t, 0.04, m === 'tense' ? 0.05 : 0.03, 'highpass', 8000, bus);
    // スネアの代わりの指パッチン
    if (inBar === 4) this.noiseBurst(t, 0.08, 0.05, 'bandpass', 1800, bus, { q: 2 });
    // アルペジオ
    const pattern = [1, 3, 2, 4, 1, 3, 4, 2];
    if (m === 'tense' || inBar !== 7) {
      const n = chord[pattern[inBar] % chord.length] + 12;
      this.pluck(t, NOTE(n), m === 'tense' ? 0.035 : 0.03, 0.4);
    }
  }

  private pluck(t: number, f: number, v: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g = ctx.createGain();
    this.env(g, t, 0.004, v, dur);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.004, v * 0.3, dur * 0.5);
    o.connect(g);
    o2.connect(g2);
    g.connect(this.musicBus);
    g.connect(this.delay);
    g2.connect(this.musicBus);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.1);
    o2.stop(t + dur + 0.1);
  }

  // ───────── 効果音 ─────────

  private ok(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  click(): void {
    if (!this.ok()) return;
    this.osc('sine', 1400, this.now, 0.04, 0.08, this.sfxBus, { to: 900 });
  }

  tick(): void {
    if (!this.ok()) return;
    this.osc('square', 2400, this.now, 0.012, 0.015, this.sfxBus);
  }

  /** 市民の声（一文字ごとのピコピコ） */
  voice(base: number, ch: string, i: number): void {
    if (!this.ok()) return;
    if (!ch.trim() || '、。！？…「」（）・ー'.includes(ch)) return;
    if (i % 2 === 1) return;
    const code = ch.codePointAt(0) ?? 0;
    const f = base * (0.85 + ((code * 37) % 23) / 55);
    const t = this.now;
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.06);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 2.5;
    bp.Q.value = 3;
    const g = ctx.createGain();
    this.env(g, t, 0.004, 0.06, 0.06);
    o.connect(bp);
    bp.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** AI の声（電子音） */
  aiVoice(i: number): void {
    if (!this.ok() || i % 3) return;
    const f = 880 + ((i * 131) % 5) * 110;
    this.osc('sine', f, this.now, 0.03, 0.025, this.sfxBus);
  }

  dispense(kind: string): void {
    if (!this.ok()) return;
    const t = this.now;
    // 配管を通る音
    this.noiseBurst(t, 0.18, 0.06, 'bandpass', 900, this.sfxBus, { q: 4, to: 2400 });
    this.osc('sine', 300, t, 0.14, 0.05, this.sfxBus, { to: 700 });
    // 落ちて混ざる音
    const t2 = t + 0.42;
    if (kind === 'liquid') {
      this.osc('sine', 260, t2, 0.12, 0.16, this.sfxBus, { to: 820 });
      this.osc('sine', 520, t2 + 0.05, 0.08, 0.06, this.sfxBus, { to: 1200 });
    } else if (kind === 'solid') {
      this.osc('sine', 160, t2, 0.1, 0.22, this.sfxBus, { to: 70 });
      this.noiseBurst(t2, 0.05, 0.08, 'lowpass', 1200, this.sfxBus);
    } else if (kind === 'crystal' || kind === 'powder' || kind === 'grain') {
      for (let i = 0; i < 6; i++) this.noiseBurst(t2 + i * 0.018, 0.03, 0.05, 'highpass', 5000 + Math.random() * 3000, this.sfxBus);
      this.osc('sine', 200, t2, 0.08, 0.1, this.sfxBus, { to: 90 });
    } else {
      // ペースト・ゲル：ぶにゅっ
      this.osc('sine', 180, t2, 0.16, 0.2, this.sfxBus, { to: 90 });
      this.noiseBurst(t2, 0.12, 0.05, 'lowpass', 600, this.sfxBus, { to: 200 });
    }
  }

  undo(): void {
    if (!this.ok()) return;
    this.osc('sine', 700, this.now, 0.12, 0.08, this.sfxBus, { to: 300 });
  }

  press(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.noiseBurst(t, 0.35, 0.08, 'highpass', 2500, this.sfxBus, { a: 0.02 });
    this.osc('sine', 90, t + 0.3, 0.25, 0.4, this.sfxBus, { to: 40 });
    this.noiseBurst(t + 0.3, 0.1, 0.12, 'lowpass', 900, this.sfxBus);
    this.noiseBurst(t + 0.45, 0.6, 0.05, 'bandpass', 3000, this.sfxBus, { q: 0.5, a: 0.03 });
  }

  drizzle(): void {
    if (!this.ok()) return;
    const t = this.now;
    for (let i = 0; i < 7; i++) this.osc('sine', 300 + Math.random() * 500, t + i * 0.07 + Math.random() * 0.03, 0.06, 0.05, this.sfxBus, { to: 900 + Math.random() * 400 });
    this.noiseBurst(t, 0.6, 0.03, 'lowpass', 900, this.sfxBus, { a: 0.05 });
  }

  clink(glass = false): void {
    if (!this.ok()) return;
    const t = this.now;
    const base = glass ? 2600 : 1900;
    for (const [r, v] of [
      [1, 0.08],
      [1.63, 0.05],
      [2.47, 0.03],
    ] as [number, number][])
      this.osc('sine', base * r, t, glass ? 0.6 : 0.35, v, this.sfxBus);
  }

  servo(): void {
    if (!this.ok()) return;
    const t = this.now;
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(230, t + 0.25);
    o.frequency.linearRampToValueAtTime(160, t + 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.5);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.55);
  }

  slide(): void {
    if (!this.ok()) return;
    this.noiseBurst(this.now, 0.9, 0.05, 'lowpass', 500, this.sfxBus, { a: 0.1 });
  }

  bell(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.osc('sine', 1318, t, 1.2, 0.12, this.sfxBus);
    this.osc('sine', 1976, t, 0.9, 0.06, this.sfxBus);
    this.osc('sine', 2637, t, 0.5, 0.03, this.sfxBus);
  }

  shutter(open: boolean): void {
    if (!this.ok()) return;
    const t = this.now;
    for (let i = 0; i < 16; i++) this.noiseBurst(t + i * 0.055, 0.05, 0.05, 'bandpass', open ? 900 + i * 40 : 1500 - i * 40, this.sfxBus, { q: 3 });
    this.osc('sine', 70, t + 0.9, 0.2, 0.18, this.sfxBus, { to: 40 });
  }

  chew(): void {
    if (!this.ok()) return;
    const t = this.now;
    for (let i = 0; i < 3; i++) this.noiseBurst(t + i * 0.16, 0.07, 0.07, 'lowpass', 700, this.sfxBus);
  }

  star(i: number): void {
    if (!this.ok()) return;
    const notes = [72, 74, 76, 79, 84];
    this.osc('triangle', NOTE(notes[i] ?? 84), this.now, 0.35, 0.12, this.sfxBus);
    this.osc('sine', NOTE((notes[i] ?? 84) + 12), this.now, 0.2, 0.04, this.sfxBus);
  }

  good(): void {
    if (!this.ok()) return;
    const t = this.now;
    [72, 76, 79, 84].forEach((n, i) => this.osc('triangle', NOTE(n), t + i * 0.09, 0.4, 0.1, this.sfxBus));
  }

  bad(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.osc('square', 196, t, 0.25, 0.05, this.sfxBus);
    this.osc('square', 164, t + 0.22, 0.4, 0.05, this.sfxBus);
  }

  buzz(): void {
    if (!this.ok()) return;
    const t = this.now;
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 110;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    this.env(g, t, 0.01, 0.08, 0.3);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.4);
  }

  alarm(): void {
    if (!this.ok()) return;
    const t = this.now;
    for (let i = 0; i < 3; i++) {
      this.osc('square', 880, t + i * 0.32, 0.14, 0.04, this.sfxBus);
      this.osc('square', 660, t + i * 0.32 + 0.16, 0.14, 0.04, this.sfxBus);
    }
  }

  discard(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.noiseBurst(t, 0.8, 0.09, 'lowpass', 2400, this.sfxBus, { to: 150, a: 0.03 });
    this.osc('sine', 400, t, 0.6, 0.08, this.sfxBus, { to: 60 });
  }

  stamp(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.osc('sine', 110, t, 0.2, 0.35, this.sfxBus, { to: 50 });
    this.noiseBurst(t, 0.08, 0.1, 'lowpass', 2000, this.sfxBus);
  }

  typeKey(): void {
    if (!this.ok()) return;
    this.noiseBurst(this.now, 0.02, 0.03, 'highpass', 3000 + Math.random() * 2000, this.sfxBus);
  }

  whoosh(): void {
    if (!this.ok()) return;
    this.noiseBurst(this.now, 0.45, 0.06, 'bandpass', 400, this.sfxBus, { to: 2400, q: 1.5, a: 0.1 });
  }

  gameOver(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.osc('sawtooth', 110, t, 2.5, 0.08, this.sfxBus, { to: 30, a: 0.05 });
    this.noiseBurst(t, 2, 0.06, 'bandpass', 1200, this.sfxBus, { to: 200, q: 0.7 });
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  newRecipe(): void {
    if (!this.ok()) return;
    const t = this.now;
    [79, 84, 88, 91].forEach((n, i) => this.osc('sine', NOTE(n), t + i * 0.07, 0.6, 0.06, this.sfxBus));
  }
}
