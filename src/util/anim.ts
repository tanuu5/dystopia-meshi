// 小さなアニメーション補助。ゲームループの時間で進む tween と待機。

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

interface Job {
  t: number;
  dur: number;
  fn: (k: number) => void;
  ease: (t: number) => number;
  resolve: () => void;
  cancelled: boolean;
}

/** ゲーム時間で動く tween 管理。update(dt) を毎フレーム呼ぶ */
export class Animator {
  private jobs: Job[] = [];
  private timers: { t: number; resolve: () => void }[] = [];

  tween(dur: number, fn: (k: number) => void, e: (t: number) => number = ease.inOutQuad): Promise<void> {
    return new Promise((resolve) => {
      if (dur <= 0) {
        fn(1);
        resolve();
        return;
      }
      this.jobs.push({ t: 0, dur, fn, ease: e, resolve, cancelled: false });
    });
  }

  wait(sec: number): Promise<void> {
    return new Promise((resolve) => this.timers.push({ t: sec, resolve }));
  }

  update(dt: number): void {
    if (this.jobs.length) {
      const done: Job[] = [];
      for (const j of this.jobs) {
        j.t += dt;
        const k = Math.min(1, j.t / j.dur);
        j.fn(j.ease(k));
        if (k >= 1) done.push(j);
      }
      if (done.length) {
        this.jobs = this.jobs.filter((j) => !done.includes(j));
        for (const j of done) j.resolve();
      }
    }
    if (this.timers.length) {
      const fired: typeof this.timers = [];
      for (const tm of this.timers) {
        tm.t -= dt;
        if (tm.t <= 0) fired.push(tm);
      }
      if (fired.length) {
        this.timers = this.timers.filter((t) => !fired.includes(t));
        for (const f of fired) f.resolve();
      }
    }
  }

  clear(): void {
    this.jobs = [];
    this.timers = [];
  }
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** フレームレートに依存しない指数減衰の補間係数 */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);
