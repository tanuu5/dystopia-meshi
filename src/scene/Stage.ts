import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { damp } from '../util/anim.ts';

/**
 * 縦長の画面では横の視野が狭くなりすぎるので、この縦横比の画面と同じ横幅が見えるよう画角を広げる。
 * 広げすぎると歪むので PORTRAIT_MAX_FOV までにとどめ、足りない分はカメラを後ろへ引く
 */
const PORTRAIT_REF_ASPECT = 0.9;
const PORTRAIT_MAX_FOV = 72;

export type Quality = 'high' | 'mid' | 'low';

export interface Shot {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

// 画面の仕上げ：色収差・ビネット・フィルムグレイン・走査線・警報の赤・グリッチ（表示空間で処理）
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uAlarm: { value: 0 },
    uGlitch: { value: 0 },
    uVignette: { value: 1 },
    uFade: { value: 0 },
    uGrain: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uAlarm;
    uniform float uGlitch;
    uniform float uVignette;
    uniform float uFade;
    uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // グリッチ：横方向のずれ
      if (uGlitch > 0.001) {
        float band = floor(uv.y * 38.0 + floor(uTime * 24.0) * 3.0);
        float r = hash(vec2(band, floor(uTime * 24.0)));
        if (r < uGlitch * 0.55) uv.x += (hash(vec2(band, 7.0)) - 0.5) * 0.08 * uGlitch;
      }
      vec2 c = uv - 0.5;
      float d = dot(c, c);
      float ca = 0.0006 + d * 0.0028 + uGlitch * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      // 色調：暗部を青緑、明部をわずかに琥珀へ
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.92, 1.0, 1.06), (1.0 - smoothstep(0.0, 0.45, l)) * 0.5);
      col = mix(col, col * vec3(1.05, 1.0, 0.94), smoothstep(0.55, 1.0, l) * 0.35);
      // 走査線
      col *= 0.985 + 0.015 * sin(uv.y * uRes.y * 1.5708);
      // ビネット
      float vig = smoothstep(0.95, 0.18, length(c * vec2(1.0, 0.86)));
      col *= mix(1.0, vig, 0.62 * uVignette);
      // 警報：画面の縁が赤く脈打つ
      if (uAlarm > 0.001) {
        float edge = smoothstep(0.22, 0.55, length(c));
        float pulse = 0.55 + 0.45 * sin(uTime * 5.0);
        col = mix(col, vec3(0.9, 0.05, 0.08), edge * pulse * uAlarm * 0.55);
      }
      // グレイン
      float g = hash(uv * uRes + fract(uTime * 13.7) * 91.0) - 0.5;
      col += g * 0.035 * uGrain;
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly final: ShaderPass;
  quality: Quality = 'high';
  private container: HTMLElement;
  private renderPass: RenderPass;
  private output: OutputPass;

  // カメラの状態
  private cur: Shot;
  private goal: Shot;
  private shotSpeed = 2.2;
  private mouse = new THREE.Vector2();
  private parallax = new THREE.Vector2();
  private shake = 0;
  private viewShift = 0;
  private viewShiftGoal = 0;
  /** 見えている領域の中央へ注目点を寄せるずらし（px）。正で絵が左・上へ動く */
  private focusX = 0;
  private focusXGoal = 0;
  private viewShiftY = 0;
  private viewShiftYGoal = 0;
  drift = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.03, 60);
    this.cur = { pos: new THREE.Vector3(0, 1.95, 1.75), target: new THREE.Vector3(0, 1.08, -0.55), fov: 42 };
    this.goal = { pos: this.cur.pos.clone(), target: this.cur.target.clone(), fov: 42 };

    this.scene.background = new THREE.Color('#06080b');
    this.scene.fog = new THREE.FogExp2('#0b1016', 0.055);

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.38, 0.5, 1.15);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);

    this.buildEnvironment();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
    this.resize();
  }

  /** 反射用の環境マップ：暗い部屋に蛍光灯とネオンを置いたものを PMREM で焼く */
  private buildEnvironment(): void {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12), new THREE.MeshBasicMaterial({ color: '#151a20', side: THREE.BackSide }));
    room.position.y = 2;
    env.add(room);
    const panel = (w: number, h: number, color: string, intensity: number, x: number, y: number, z: number, rx = 0, ry = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      env.add(m);
    };
    // 天井の蛍光灯
    for (let i = -2; i <= 2; i++) panel(0.35, 4.5, '#eaf4ff', 3.2, i * 1.6, 4.9, 0, Math.PI / 2);
    // ネオンの差し色
    panel(3, 1.2, '#35e0ff', 3.2, -5.9, 2.2, 0, 0, Math.PI / 2);
    panel(3, 1.2, '#ff3d9a', 2.2, 5.9, 2.0, -1, 0, -Math.PI / 2);
    panel(4, 1.4, '#9fc4e0', 1.6, 0, 1.6, -5.9);
    panel(1.2, 0.8, '#ffb347', 2.2, -3.5, 1.4, -5.9);
    panel(5, 1.0, '#9fb8d0', 1.2, 0, 1.2, 5.9, 0, Math.PI);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(env, 0.035);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.final.uniforms.uRes.value.set(size.x, size.y);
    this.applyViewShift();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const pr = q === 'high' ? Math.min(window.devicePixelRatio, 1.75) : q === 'mid' ? Math.min(window.devicePixelRatio, 1.25) : 1;
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.bloom.enabled = q !== 'low';
    this.resize();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
  }

  setShot(shot: Partial<Shot>, speed = 2.2): void {
    if (shot.pos) this.goal.pos.copy(shot.pos);
    if (shot.target) this.goal.target.copy(shot.target);
    if (shot.fov) this.goal.fov = shot.fov;
    this.shotSpeed = speed;
  }

  snapShot(shot: Shot): void {
    this.goal = { pos: shot.pos.clone(), target: shot.target.clone(), fov: shot.fov };
    this.cur = { pos: shot.pos.clone(), target: shot.target.clone(), fov: shot.fov };
  }

  addShake(v: number): void {
    this.shake = Math.min(1, this.shake + v);
  }

  /** 右側に引き出しパネルがあるとき、画面の中心をずらす（ピクセル） */
  setViewShift(px: number): void {
    this.viewShiftGoal = px;
  }

  /**
   * 3D が見えている領域（CSS px）。注目点がこの領域の中央に来るよう、絵を上下左右にずらす。
   * null なら画面の中央（広い画面）
   */
  setFocusRect(r: { left: number; right: number; top: number; bottom: number } | null): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.focusXGoal = r ? w / 2 - (r.left + r.right) / 2 : 0;
    this.viewShiftYGoal = r ? h / 2 - (r.top + r.bottom) / 2 : 0;
  }

  private applyViewShift(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const x = this.viewShift + this.focusX;
    if (Math.abs(x) < 0.5 && Math.abs(this.viewShiftY) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, x, this.viewShiftY, w, h);
  }

  update(dt: number, time: number): void {
    const k = damp(this.shotSpeed, dt);
    this.cur.pos.lerp(this.goal.pos, k);
    this.cur.target.lerp(this.goal.target, k);
    this.cur.fov += (this.goal.fov - this.cur.fov) * k;

    this.parallax.lerp(this.mouse, damp(2.5, dt));
    const cam = this.camera;
    // 縦長の画面：横の視野を保つよう画角を広げ、広げきれない分はカメラを引く
    let fov = this.cur.fov;
    let dolly = 1;
    if (cam.aspect < PORTRAIT_REF_ASPECT) {
      let tv = (Math.tan(THREE.MathUtils.degToRad(fov / 2)) * PORTRAIT_REF_ASPECT) / cam.aspect;
      const tMax = Math.tan(THREE.MathUtils.degToRad(PORTRAIT_MAX_FOV / 2));
      if (tv > tMax) {
        dolly = tv / tMax;
        tv = tMax;
      }
      fov = THREE.MathUtils.radToDeg(Math.atan(tv) * 2);
    }
    cam.position.copy(this.cur.pos);
    if (dolly !== 1) cam.position.sub(this.cur.target).multiplyScalar(dolly).add(this.cur.target);
    cam.position.x += this.parallax.x * 0.06 + Math.sin(time * 0.13) * 0.02 * (1 + this.drift * 6);
    cam.position.y += -this.parallax.y * 0.035 + Math.sin(time * 0.21) * 0.01 * (1 + this.drift * 3);
    const t = this.cur.target.clone();
    t.x += this.parallax.x * 0.03;
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.02;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.lookAt(t);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // ずらしは少しずつ（パネルの出し入れで絵が跳ねないように）
    const ease = (cur: number, goal: number, rate: number) => {
      const v = cur + (goal - cur) * damp(rate, dt);
      return Math.abs(v - goal) < 0.3 ? goal : v;
    };
    const vs = ease(this.viewShift, this.viewShiftGoal, 6);
    const fx = ease(this.focusX, this.focusXGoal, 4);
    const vy = ease(this.viewShiftY, this.viewShiftYGoal, 4);
    if (vs !== this.viewShift || fx !== this.focusX || vy !== this.viewShiftY) {
      this.viewShift = vs;
      this.focusX = fx;
      this.viewShiftY = vy;
      this.applyViewShift();
    }
    this.final.uniforms.uTime.value = time;
  }

  render(): void {
    if (this.quality === 'low') {
      // 低画質：ポストエフェクトを最小限に（OutputPass と仕上げだけ）
      this.bloom.enabled = false;
    }
    this.composer.render();
  }
}
