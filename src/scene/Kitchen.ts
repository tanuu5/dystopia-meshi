import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mats, emissive, basicGlow, boxUV } from './materials.ts';
import { signTexture, posterTexture, padTexture, holoTexture, radialTexture, FONT_MONO, FONT_DISPLAY } from './textures.ts';
import {
  COUNTER_Y,
  WALL_Z,
  WALL_BACK_Z,
  HATCH,
  LEDGE_Y,
  PAD,
  PAD_TOP,
  PAD_R,
  TRAY_KITCHEN,
  ELEVATOR,
  TANK_RACKS,
} from './layout.ts';
import { damp } from '../util/anim.ts';
import { mergeByMaterial } from './merge.ts';

// 厨房（プレイヤー側）の静的な部分と、シャッター・トレイ・加熱リングなどの可動部

export class Kitchen {
  readonly group = new THREE.Group();
  readonly shutter = new THREE.Group();
  readonly tray = new THREE.Group();
  readonly elevator = new THREE.Group();
  readonly field: THREE.Mesh;
  readonly heatRing: THREE.Mesh;
  readonly heatLight: THREE.PointLight;
  readonly stageSpot: THREE.SpotLight;
  readonly hatchLamp: THREE.Mesh;
  readonly monitors: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];
  private fieldMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshStandardMaterial;
  private fieldGlow = 0;
  private fieldGoal = 0;
  private temp = 0;
  private heatActivity = 0;
  shutterOpen = 0;
  private shutterGoal = 0;
  private beacon: THREE.Mesh;
  private beaconLight: THREE.PointLight;
  private alarm = 0;
  private padIris: THREE.Mesh;
  irisOpen = 0;

  constructor() {
    RectAreaLightUniformsLib.init();
    const M = mats();
    const g = this.group;

    // ── 床・天井・壁 ──
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.2), M.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 1.2);
    floor.receiveShadow = true;
    g.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.2), M.blackMetal);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 3.1, 1.2);
    g.add(ceil);

    // 配膳口のある壁（開口部のまわりを箱で組む）
    const wallD = WALL_Z - WALL_BACK_Z;
    const wz = (WALL_Z + WALL_BACK_Z) / 2;
    const addWall = (x0: number, x1: number, y0: number, y1: number) => {
      const m = new THREE.Mesh(boxUV(x1 - x0, y1 - y0, wallD, 0.9), M.wall);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, wz);
      m.receiveShadow = true;
      m.castShadow = true;
      g.add(m);
      return m;
    };
    addWall(-3.4, HATCH.x0, 0, 3.1);
    addWall(HATCH.x1, 3.4, 0, 3.1);
    addWall(HATCH.x0, HATCH.x1, HATCH.y1, 3.1);
    addWall(HATCH.x0, HATCH.x1, 0, HATCH.y0 - 0.02);
    // 側壁
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(boxUV(0.1, 3.1, 4.2, 0.9), M.wall);
      side.position.set(s * 3.4, 1.55, 1.2);
      g.add(side);
    }

    // 開口部の枠（ステンレス）と警告ストライプ
    const frameT = 0.05;
    const frameMat = M.steelDark;
    const fw = HATCH.x1 - HATCH.x0;
    const fh = HATCH.y1 - HATCH.y0;
    const frames: [number, number, number, number, number, number][] = [
      [0, HATCH.y1 + frameT / 2, fw + frameT * 2, frameT, 0.24, 0],
      [HATCH.x0 - frameT / 2, (HATCH.y0 + HATCH.y1) / 2, frameT, fh, 0.24, 0],
      [HATCH.x1 + frameT / 2, (HATCH.y0 + HATCH.y1) / 2, frameT, fh, 0.24, 0],
    ];
    for (const [x, y, w, h, d] of frames) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
      m.position.set(x, y, wz + 0.02);
      m.castShadow = true;
      g.add(m);
    }
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(fw + 0.1, 0.06), M.hazard);
    stripe.position.set(0, HATCH.y1 + 0.085, WALL_Z + 0.012);
    g.add(stripe);

    // 配膳口の看板
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.13),
      new THREE.MeshBasicMaterial({
        map: signTexture(
          [
            { text: '配膳口', size: 54, color: '#ffcf6a' },
            { text: 'SERVING HATCH  No.07', size: 22, color: '#ffcf6a', font: FONT_MONO, weight: '400' },
          ],
          512,
          128,
          '#16120a',
          'rgba(255,190,90,0.6)',
        ),
        toneMapped: false,
      }),
    );
    sign.position.set(0, HATCH.y1 + 0.3, WALL_Z + 0.01);
    g.add(sign);

    // 回転灯（シャッターが動くときに光る）
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), emissive('#ff8a1c', 0.2));
    this.beacon.position.set(HATCH.x1 + 0.16, HATCH.y1 + 0.16, WALL_Z + 0.05);
    g.add(this.beacon);
    const bBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 16), M.blackMetal);
    bBase.position.copy(this.beacon.position).add(new THREE.Vector3(0, -0.012, 0));
    g.add(bBase);
    this.beaconLight = new THREE.PointLight('#ff8a1c', 0, 2.5, 2);
    this.beaconLight.position.copy(this.beacon.position).add(new THREE.Vector3(0, 0.05, 0.1));
    g.add(this.beaconLight);

    // 状態ランプ（配膳口の左上）
    this.hatchLamp = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), emissive('#35e0ff', 2.5));
    this.hatchLamp.position.set(HATCH.x0 - 0.16, HATCH.y1 + 0.16, WALL_Z + 0.012);
    g.add(this.hatchLamp);

    // ── シャッター（壁の中を上下する） ──
    const slatMat = new THREE.MeshStandardMaterial({ color: '#8a939c', metalness: 0.85, roughness: 0.42, roughnessMap: M.brushed });
    const slats = 14;
    const slatH = fh / slats;
    for (let i = 0; i < slats; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.02, slatH * 0.92, 0.025), slatMat);
      s.position.set(0, HATCH.y0 + slatH * (i + 0.5), 0);
      s.castShadow = true;
      this.shutter.add(s);
      const groove = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.02, slatH * 0.12, 0.028), M.blackMetal);
      groove.position.set(0, HATCH.y0 + slatH * (i + 1) - slatH * 0.04, 0);
      this.shutter.add(groove);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.04), M.hazard);
    handle.position.set(0, HATCH.y0 + 0.03, 0.02);
    this.shutter.add(handle);
    this.shutter.position.z = WALL_Z - 0.03;
    g.add(this.shutter);

    // ── 配膳口の棚とトレイ ──
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.03, 0.95), M.steel);
    ledge.position.set(0, LEDGE_Y - 0.015, -0.78);
    ledge.receiveShadow = true;
    g.add(ledge);
    const rails: number[] = [-0.2, 0.2];
    for (const x of rails) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.95), M.blackMetal);
      r.position.set(x, LEDGE_Y + 0.004, -0.78);
      g.add(r);
    }
    const trayMesh = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.018, 0.32, 3, 0.008), new THREE.MeshStandardMaterial({ color: '#6f7f86', metalness: 0.4, roughness: 0.45 }));
    trayMesh.position.y = 0.012;
    trayMesh.castShadow = true;
    trayMesh.receiveShadow = true;
    this.tray.add(trayMesh);
    this.tray.position.copy(TRAY_KITCHEN);
    g.add(this.tray);

    // ── 調理台 ──
    const counterBody = new THREE.Mesh(boxUV(5.6, COUNTER_Y - 0.04, 1.6, 0.9), M.gunmetal);
    counterBody.position.set(0, (COUNTER_Y - 0.04) / 2, 0.18);
    g.add(counterBody);
    const top = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.04, 1.6), M.steel);
    top.position.set(0, COUNTER_Y - 0.02, 0.18);
    top.receiveShadow = true;
    top.castShadow = true;
    g.add(top);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 5.6, 12), M.steel);
    lip.rotation.z = Math.PI / 2;
    lip.position.set(0, COUNTER_Y - 0.02, 0.98);
    g.add(lip);
    // 壁際の立ち上がり
    const splash = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.12, 0.02), M.steel);
    splash.position.set(0, COUNTER_Y + 0.06, WALL_Z + 0.01);
    g.add(splash);

    // ── 円形ステージ（成形台）──
    const base = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R + 0.04, PAD_R + 0.06, 0.05, 64), M.steelDark);
    base.position.set(PAD.x, COUNTER_Y + 0.025, PAD.z);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    const padTop = new THREE.Mesh(
      new THREE.CircleGeometry(PAD_R, 64),
      new THREE.MeshStandardMaterial({ map: padTexture(), metalness: 0.6, roughness: 0.35, emissive: '#1a4a5a', emissiveIntensity: 0.25 }),
    );
    padTop.rotation.x = -Math.PI / 2;
    padTop.position.set(PAD.x, PAD_TOP - 0.004, PAD.z);
    padTop.receiveShadow = true;
    g.add(padTop);
    // 廃棄口（中央の絞り）
    this.padIris = new THREE.Mesh(new THREE.CircleGeometry(0.1, 48), new THREE.MeshBasicMaterial({ color: '#000' }));
    this.padIris.rotation.x = -Math.PI / 2;
    this.padIris.position.set(PAD.x, PAD_TOP - 0.002, PAD.z);
    this.padIris.scale.setScalar(0.001);
    g.add(this.padIris);

    this.ringMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#35e0ff', emissiveIntensity: 1.2, roughness: 0.4 });
    this.heatRing = new THREE.Mesh(new THREE.TorusGeometry(PAD_R - 0.01, 0.011, 12, 96), this.ringMat);
    this.heatRing.rotation.x = Math.PI / 2;
    this.heatRing.position.set(PAD.x, PAD_TOP + 0.004, PAD.z);
    g.add(this.heatRing);
    this.heatLight = new THREE.PointLight('#ff7a2a', 0, 1.6, 2);
    this.heatLight.position.set(PAD.x, PAD_TOP + 0.42, PAD.z + 0.1);
    g.add(this.heatLight);

    // 反重力場（ホログラムの円筒）
    const holo = holoTexture();
    this.fieldMat = new THREE.MeshBasicMaterial({
      color: '#46d8ff',
      map: holo,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.field = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R - 0.03, PAD_R - 0.03, 0.62, 64, 1, true), this.fieldMat);
    this.field.position.set(PAD.x, PAD_TOP + 0.31, PAD.z);
    g.add(this.field);
    const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(PAD_R * 1.25, 48), basicGlow('#2ab8e6', 0.22));
    glowDisc.material.map = radialTexture();
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.set(PAD.x, PAD_TOP + 0.002, PAD.z);
    g.add(glowDisc);

    // ── 器のエレベーター ──
    const ev = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.22), M.blackMetal);
    ev.position.set(ELEVATOR.x, COUNTER_Y + 0.001, ELEVATOR.z);
    g.add(ev);
    const evRim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.006, 6, 4), emissive('#35e0ff', 1.2));
    evRim.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    evRim.position.set(ELEVATOR.x, COUNTER_Y + 0.006, ELEVATOR.z);
    g.add(evRim);
    this.elevator.position.set(ELEVATOR.x, COUNTER_Y - 0.25, ELEVATOR.z);
    g.add(this.elevator);

    // ── タンク棚の台座 ──
    for (const r of TANK_RACKS) {
      const plinth = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.07, 0.56, 3, 0.02), M.gunmetal);
      plinth.position.set(r.x, COUNTER_Y + 0.035, r.z);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      g.add(plinth);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.008, 0.005), emissive('#35e0ff', 1.4));
      strip.position.set(r.x, COUNTER_Y + 0.05, r.z + 0.282);
      g.add(strip);
    }

    // ── 壁の飾り：配管、モニター、ポスター、時計 ──
    this.buildWallDetails();
    // 動かない小物はマテリアルごとにまとめる（描画コール削減）
    mergeByMaterial(this.group, new Set<THREE.Object3D>([this.beacon, this.hatchLamp, this.padIris, this.heatRing, this.field]));
    mergeByMaterial(this.shutter);

    // ── 照明 ──
    const hemi = new THREE.HemisphereLight('#9fb6cc', '#1a1510', 0.22);
    g.add(hemi);
    // 天井の蛍光灯（面光源）
    for (const x of [-1.3, 1.3]) {
      const ra = new THREE.RectAreaLight('#dfeeff', 2.2, 0.18, 1.6);
      ra.position.set(x, 2.95, 0.5);
      ra.lookAt(x, 0, 0.5);
      g.add(ra);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 1.6), emissive('#e8f4ff', 3));
      tube.position.set(x, 3.07, 0.5);
      g.add(tube);
    }
    // ステージを照らすスポット（影を落とす主光源）
    this.stageSpot = new THREE.SpotLight('#fff1dc', 12, 6, Math.PI / 5.2, 0.55, 1.6);
    this.stageSpot.position.set(0.3, 2.95, 1.25);
    this.stageSpot.target.position.set(0, COUNTER_Y, 0.35);
    this.stageSpot.castShadow = true;
    this.stageSpot.shadow.mapSize.set(2048, 2048);
    this.stageSpot.shadow.bias = -0.0004;
    this.stageSpot.shadow.normalBias = 0.02;
    this.stageSpot.shadow.radius = 4;
    this.stageSpot.shadow.camera.near = 0.8;
    this.stageSpot.shadow.camera.far = 5;
    g.add(this.stageSpot, this.stageSpot.target);
    // シアンとマゼンタの差し色
    const cyan = new THREE.PointLight('#2fd6ff', 2.2, 4, 2);
    cyan.position.set(-2.2, 1.6, 0.6);
    g.add(cyan);
    const mag = new THREE.PointLight('#ff3f9e', 1.1, 4, 2);
    mag.position.set(2.3, 1.7, 0.4);
    g.add(mag);
    const front = new THREE.PointLight('#bcd4ea', 1.0, 5, 2);
    front.position.set(0, 2.2, 2.4);
    g.add(front);
  }

  private buildWallDetails(): void {
    const M = mats();
    const g = this.group;
    // 横に走る配管
    const pipeMat = new THREE.MeshStandardMaterial({ color: '#6c747c', metalness: 0.9, roughness: 0.35 });
    const pipes = [
      { y: 2.28, r: 0.035, c: pipeMat },
      { y: 2.4, r: 0.022, c: new THREE.MeshStandardMaterial({ color: '#8a4a2a', metalness: 0.8, roughness: 0.4 }) },
      { y: 2.5, r: 0.05, c: pipeMat },
    ];
    for (const p of pipes) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 6.6, 16), p.c);
      m.rotation.z = Math.PI / 2;
      m.position.set(0, p.y, WALL_Z + 0.08);
      g.add(m);
      for (let x = -3; x <= 3; x += 1.2) {
        const clamp = new THREE.Mesh(new THREE.TorusGeometry(p.r + 0.006, 0.008, 6, 16), M.blackMetal);
        clamp.rotation.y = Math.PI / 2;
        clamp.position.set(x, p.y, WALL_Z + 0.08);
        g.add(clamp);
      }
    }

    // 状態モニター（左右の壁）
    const mk = (x: number, y: number, w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = Math.round((256 * h) / w);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      screen.position.set(x, y, WALL_Z + 0.03);
      const bezel = new THREE.Mesh(new RoundedBoxGeometry(w + 0.04, h + 0.04, 0.04, 2, 0.01), M.blackMetal);
      bezel.position.set(x, y, WALL_Z + 0.008);
      g.add(bezel, screen);
      this.monitors.push({ mesh: screen, canvas: c, tex });
    };
    mk(-1.28, 1.72, 0.44, 0.26);
    mk(1.3, 1.74, 0.36, 0.24);

    // ポスター
    const posters: [string, string, string, number, number][] = [
      ['感謝して食べよう', '残食は資源の損失です', '#9b2d2a', -2.05, 1.62],
      ['幸福は義務', '市民満足度を守りましょう', '#2c4a6b', 2.02, 1.6],
    ];
    for (const [t, s, c, x, y] of posters) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.51), new THREE.MeshStandardMaterial({ map: posterTexture(t, s, c), roughness: 0.85 }));
      p.position.set(x, y, WALL_Z + 0.012);
      p.rotation.z = (Math.random() - 0.5) * 0.04;
      g.add(p);
    }

    // 換気口
    const vent = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.04), M.steelDark);
      s.position.set(0, i * 0.035, 0.02);
      s.rotation.x = -0.5;
      vent.add(s);
    }
    const ventFrame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.28, 0.02), M.blackMetal);
    ventFrame.position.set(0, 0.105, 0);
    vent.add(ventFrame);
    vent.position.set(-1.25, 2.02, WALL_Z + 0.02);
    g.add(vent);

    // 壁の MEAL-7 ロゴ
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.12),
      new THREE.MeshBasicMaterial({
        map: signTexture([{ text: 'MEAL-7', size: 88, color: '#6fe7ff', font: FONT_DISPLAY }], 512, 128),
        transparent: true,
        toneMapped: false,
      }),
    );
    logo.position.set(1.3, 2.02, WALL_Z + 0.012);
    g.add(logo);
  }

  // ── 可動部の制御 ──

  setShutter(open: boolean): void {
    this.shutterGoal = open ? 1 : 0;
  }

  /** 温度（-1..1.25）と加熱・冷却の強さ（0..1） */
  setTemp(t: number, activity: number): void {
    this.temp = t;
    this.heatActivity = activity;
  }

  setFieldActive(on: boolean): void {
    this.fieldGoal = on ? 0.16 : 0;
  }

  setAlarm(v: number): void {
    this.alarm = v;
  }

  update(dt: number, time: number): void {
    // シャッター
    const prev = this.shutterOpen;
    this.shutterOpen += (this.shutterGoal - this.shutterOpen) * damp(3.2, dt);
    if (Math.abs(this.shutterGoal - this.shutterOpen) < 0.002) this.shutterOpen = this.shutterGoal;
    this.shutter.position.y = this.shutterOpen * (HATCH.y1 - HATCH.y0 + 0.02);
    const moving = Math.abs(this.shutterOpen - prev) > 0.0005;
    const bm = this.beacon.material as THREE.MeshStandardMaterial;
    const flash = moving ? 0.5 + 0.5 * Math.sin(time * 14) : 0;
    bm.emissiveIntensity = 0.25 + flash * 5;
    this.beaconLight.intensity = flash * 3;

    // 反重力場
    this.fieldGlow += (this.fieldGoal - this.fieldGlow) * damp(3, dt);
    this.fieldMat.opacity = this.fieldGlow * (0.8 + 0.2 * Math.sin(time * 3.1));
    this.field.visible = this.fieldGlow > 0.01;
    (this.fieldMat.map as THREE.Texture).offset.y = -time * 0.25;
    this.field.rotation.y = time * 0.3;

    // 加熱リング：常温は水色、加熱で橙、冷却で青白
    const t = this.temp;
    const col = new THREE.Color();
    if (t > 0.05) col.setHSL(0.07 - Math.min(t, 1.2) * 0.05, 1, 0.5);
    else if (t < -0.05) col.setHSL(0.58, 0.9, 0.62 + Math.min(-t, 1) * 0.2);
    else col.set('#35e0ff');
    this.ringMat.emissive.lerp(col, damp(6, dt));
    const act = this.heatActivity;
    this.ringMat.emissiveIntensity = 1 + act * 4 + Math.abs(t) * 0.8;
    this.heatLight.color.copy(this.ringMat.emissive);
    this.heatLight.intensity = act * 1.4;

    // 状態ランプ
    const lamp = this.hatchLamp.material as THREE.MeshStandardMaterial;
    if (this.alarm > 0) lamp.emissive.set('#ff2a3a');
    else lamp.emissive.set('#35e0ff');
    lamp.emissiveIntensity = 1.5 + Math.sin(time * (this.alarm > 0 ? 8 : 2)) * 1;

    // 廃棄口
    this.padIris.scale.setScalar(Math.max(0.001, this.irisOpen));
  }
}
