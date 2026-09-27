import * as THREE from 'three';
import { mats, emissive } from './materials.ts';
import { floorTiles, signTexture, FONT_DISPLAY, FONT_MONO, FONT_JP } from './textures.ts';
import { HALL_SLOGANS, PROPAGANDA } from '../data/lines.ts';
import { WALL_BACK_Z, LEDGE_Y, HATCH } from './layout.ts';
import { CustomerModel } from './Customer.ts';
import { mergeByMaterial } from './merge.ts';
import { randomCitizen } from '../data/characters.ts';
import { makeRng } from '../util/rng.ts';

// 配膳口の向こうの配給食堂。灰色の市民、長机、宣伝スクリーン、雨の窓、行列。

export class Hall {
  readonly group = new THREE.Group();
  private screenCanvas: HTMLCanvasElement;
  private screenTex: THREE.CanvasTexture;
  private screenT = 0;
  private sloganIdx = 0;
  private rainMat: THREE.ShaderMaterial;
  private diners: THREE.InstancedMesh;
  private dinerHeads: THREE.InstancedMesh;
  private dinerSeeds: { x: number; z: number; ry: number; s: number; phase: number }[] = [];
  private queue: THREE.Group[] = [];
  private queueModels: CustomerModel[] = [];
  private queueOffset = 0;
  private camLight: THREE.Mesh;
  private flicker: THREE.PointLight;
  private lightning = 0;
  private dummy = new THREE.Object3D();

  constructor() {
    const M = mats();
    const g = this.group;
    const z0 = WALL_BACK_Z;

    // 客席側のカウンター
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, LEDGE_Y, 0.5), new THREE.MeshStandardMaterial({ color: '#3a4046', metalness: 0.5, roughness: 0.6 }));
    counter.position.set(0, LEDGE_Y / 2 - 0.015, z0 - 0.25);
    counter.receiveShadow = true;
    g.add(counter);
    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.03, 0.56), M.steel);
    counterTop.position.set(0, LEDGE_Y - 0.015, z0 - 0.25);
    counterTop.receiveShadow = true;
    g.add(counterTop);
    // 客席側の壁（配膳口の外側）
    const outerWall = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshStandardMaterial({ color: '#2c3238', roughness: 0.8 }));
    outerWall.position.set(0, 2.25, z0 - 0.001);
    outerWall.rotation.y = Math.PI;
    g.add(outerWall);

    // 床
    const ft = floorTiles('#2a2e33', '#16191c', 10);
    ft.repeat.set(10, 12);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 16), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.4, metalness: 0.1, color: '#7c858e' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, z0 - 8);
    floor.receiveShadow = true;
    g.add(floor);
    // 天井
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(14, 16), new THREE.MeshStandardMaterial({ color: '#15191d', roughness: 0.9 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 4.2, z0 - 8);
    g.add(ceil);
    // 天井の長い照明
    const barOn = emissive('#c8dcff', 1.6);
    const barOff = emissive('#c8dcff', 0.2);
    for (let i = 0; i < 6; i++) {
      for (const x of [-2.6, 0, 2.6]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 1.4), i === 2 && x === 2.6 ? barOff : barOn);
        bar.position.set(x, 4.15, z0 - 1.6 - i * 2.2);
        g.add(bar);
      }
    }
    // 奥の壁と柱
    const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.2), new THREE.MeshStandardMaterial({ color: '#1d2227', roughness: 0.85 }));
    back.position.set(0, 2.1, z0 - 15);
    g.add(back);
    for (const x of [-6.8, 6.8]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(16, 4.2), new THREE.MeshStandardMaterial({ color: '#20262b', roughness: 0.85 }));
      side.position.set(x, 2.1, z0 - 8);
      side.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(side);
    }
    const colMat = new THREE.MeshStandardMaterial({ color: '#2b3137', roughness: 0.7 });
    for (let i = 0; i < 4; i++) {
      for (const x of [-4.2, 4.2]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.2, 0.4), colMat);
        col.position.set(x, 2.1, z0 - 2.5 - i * 3.4);
        col.castShadow = true;
        g.add(col);
      }
    }

    // 雨の窓（左右の壁の高いところ）
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uFlash; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        void main(){
          vec2 uv = vUv * vec2(18.0, 6.0);
          vec3 sky = mix(vec3(0.03,0.05,0.09), vec3(0.08,0.12,0.2), vUv.y);
          // 遠くの街の灯
          float city = step(0.86, h(floor(vUv * vec2(60.0, 20.0)))) * step(vUv.y, 0.45);
          sky += city * vec3(1.0, 0.7, 0.35) * 0.35;
          float r = 0.0;
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            vec2 q = uv * (1.0 + fi * 0.6);
            q.y += uTime * (3.0 + fi);
            vec2 id = floor(q);
            float rnd = h(id + fi * 13.0);
            vec2 f = fract(q);
            float streak = smoothstep(0.03, 0.0, abs(f.x - rnd)) * smoothstep(0.0, 0.6, f.y) * step(0.7, rnd);
            r += streak * (0.35 - fi * 0.08);
          }
          vec3 col = sky + r * vec3(0.55, 0.65, 0.8) + uFlash * vec3(0.6, 0.7, 0.9);
          // 窓枠の格子
          vec2 gv = fract(vUv * vec2(3.0, 2.0));
          float frame = step(gv.x, 0.03) + step(gv.y, 0.04);
          col = mix(col, vec3(0.02), clamp(frame, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    for (let i = 0; i < 3; i++) {
      for (const x of [-6.78, 6.78]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.3), this.rainMat);
        win.position.set(x, 3.0, z0 - 3.5 - i * 3.6);
        win.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
        g.add(win);
      }
    }

    // 宣伝スクリーン（奥の壁）
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 1024;
    this.screenCanvas.height = 384;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.1), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    screen.position.set(0, 2.6, z0 - 14.9);
    g.add(screen);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(5.9, 2.4, 0.1), M.blackMetal);
    bezel.position.set(0, 2.6, z0 - 14.97);
    g.add(bezel);
    const screenGlow = new THREE.PointLight('#ff9a50', 3, 9, 2);
    screenGlow.position.set(0, 2.5, z0 - 13.5);
    g.add(screenGlow);
    this.drawScreen(0);

    // 横断幕
    HALL_SLOGANS.slice(0, 4).forEach((t, i) => {
      const tex = signTexture([{ text: t, size: 70, color: '#f3e7cf', font: FONT_DISPLAY }], 512, 128, '#7a1f1c');
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.37), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: '#3a0a08', emissiveIntensity: 0.2 }));
      const left = i % 2 === 0;
      banner.position.set(left ? -6.75 : 6.75, 2.0, z0 - 4.5 - Math.floor(i / 2) * 5.5);
      banner.rotation.y = left ? Math.PI / 2 : -Math.PI / 2;
      g.add(banner);
    });

    // 監視カメラ
    const cam = new THREE.Group();
    const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.26), new THREE.MeshStandardMaterial({ color: '#d8dbe0', roughness: 0.5 }));
    cam.add(camBody);
    this.camLight = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), emissive('#ff2030', 3));
    this.camLight.position.set(0.05, 0.03, 0.13);
    cam.add(this.camLight);
    cam.position.set(-3.8, 3.7, z0 - 1.2);
    cam.rotation.set(-0.5, -0.6, 0);
    g.add(cam);

    // 長机と、灰色のキューブを食べる市民たち
    const tableMat = new THREE.MeshStandardMaterial({ color: '#4a5058', roughness: 0.55, metalness: 0.4 });
    const trayMat = new THREE.MeshStandardMaterial({ color: '#6a7a80', roughness: 0.5 });
    const cubeMat = new THREE.MeshStandardMaterial({ color: '#8f969d', roughness: 0.6 });
    const rows = [-3.6, -6.4, -9.2, -12];
    for (const rz of rows) {
      for (const x of [-2.2, 2.2]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.8), tableMat);
        t.position.set(x, 0.78, z0 + rz);
        t.castShadow = true;
        t.receiveShadow = true;
        g.add(t);
        for (const lx of [-1.15, 1.15]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.6), tableMat);
          leg.position.set(x + lx, 0.39, z0 + rz);
          g.add(leg);
        }
        for (let k = 0; k < 4; k++) {
          for (const side of [-1, 1]) {
            const tr = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.015, 0.24), trayMat);
            tr.position.set(x - 0.9 + k * 0.6, 0.81, z0 + rz + side * 0.2);
            g.add(tr);
            const cube = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), cubeMat);
            cube.position.set(x - 0.9 + k * 0.6 + 0.06, 0.845, z0 + rz + side * 0.2);
            g.add(cube);
          }
        }
      }
    }
    // 市民のシルエット（インスタンス）
    const n = rows.length * 2 * 4 * 2;
    const bodyGeo = new THREE.CapsuleGeometry(0.17, 0.35, 4, 10);
    const headGeo = new THREE.SphereGeometry(0.11, 14, 10);
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#5a6168', roughness: 0.85 });
    const headMat = new THREE.MeshStandardMaterial({ color: '#c9a88c', roughness: 0.7 });
    this.diners = new THREE.InstancedMesh(bodyGeo, bodyMat, n);
    this.dinerHeads = new THREE.InstancedMesh(headGeo, headMat, n);
    this.diners.castShadow = true;
    let i = 0;
    const shades = ['#59616b', '#4c5a66', '#5f6a55', '#6b6a5a', '#4a4f5a', '#5a6470'];
    const skins = ['#e9c3a2', '#d6a57e', '#c99470', '#f1cdb0', '#b8805c'];
    for (const rz of rows) {
      for (const x of [-2.2, 2.2]) {
        for (let k = 0; k < 4; k++) {
          for (const side of [-1, 1]) {
            if ((i * 7) % 5 === 3) {
              // 空席
              this.dinerSeeds.push({ x: 0, z: 0, ry: 0, s: 0, phase: 0 });
              i++;
              continue;
            }
            this.dinerSeeds.push({ x: x - 0.9 + k * 0.6, z: z0 + rz + side * 0.62, ry: side > 0 ? Math.PI : 0, s: 0.92 + ((i * 13) % 7) * 0.02, phase: i * 1.7 });
            this.diners.setColorAt(i, new THREE.Color(shades[i % shades.length]));
            this.dinerHeads.setColorAt(i, new THREE.Color(skins[i % skins.length]));
            i++;
          }
        }
      }
    }
    g.add(this.diners, this.dinerHeads);

    // 行列（配膳口の向こう、右奥に並ぶ）。本物の市民モデルを立たせる
    const rng = makeRng(707);
    for (let q = 0; q < 3; q++) {
      const cz = randomCitizen(rng, 900 + q);
      const m = new CustomerModel(cz.look, { standing: true });
      m.lookAt.set(0, 1.4, 1.5);
      m.root.traverse((o) => (o.castShadow = false));
      if (q > 0 && rng() < 0.5) m.setMood('sleepy');
      this.group.add(m.root);
      this.queue.push(m.root);
      this.queueModels.push(m);
    }
    this.layoutQueue(0);

    // 客席の照明：客の真上のペンダントライト
    const pendant = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.14, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2f35', side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 }));
    pendant.position.set(0, 2.3, z0 - 0.75);
    g.add(pendant);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), emissive('#ffd9a0', 6));
    bulb.position.set(0, 2.25, z0 - 0.75);
    g.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.8, 6), M.rubber);
    cord.position.set(0, 3.3, z0 - 0.75);
    g.add(cord);
    const custSpot = new THREE.SpotLight('#ffe2c0', 3.2, 4.5, Math.PI / 6, 0.7, 1.6);
    custSpot.position.set(0, 2.6, z0 - 0.35);
    custSpot.target.position.set(0, 1.25, z0 - 0.8);
    custSpot.castShadow = true;
    custSpot.shadow.mapSize.set(1024, 1024);
    custSpot.shadow.bias = -0.0005;
    custSpot.shadow.radius = 5;
    g.add(custSpot, custSpot.target);
    // 顔を正面から少し照らす（厨房からの照り返し）
    const faceFill = new THREE.PointLight('#cfe8ff', 0.9, 3, 2);
    faceFill.position.set(0, 1.62, WALL_BACK_Z + 0.25 + HATCH.y0 * 0);
    g.add(faceFill);
    const hallFill = new THREE.HemisphereLight('#6b7f99', '#15120e', 0.35);
    hallFill.position.set(0, 4, z0 - 6);
    g.add(hallFill);
    this.flicker = new THREE.PointLight('#bcd0ff', 1.5, 10, 2);
    this.flicker.position.set(2.6, 3.9, z0 - 6);
    g.add(this.flicker);
    // 動かない家具はマテリアルごとにまとめる（描画コール削減）
    mergeByMaterial(g, new Set<THREE.Object3D>([this.camLight]));
  }

  /** 行列を詰める（配膳口の奥、右から左へ） */
  private layoutQueue(offset: number): void {
    this.queue.forEach((p, i) => {
      const k = i + offset;
      p.position.set(1.0 + k * 0.55, 0, WALL_BACK_Z - 1.45 - k * 0.5);
      p.rotation.y = -0.55;
      p.visible = k < 3;
    });
  }

  /** 次の客が呼ばれたとき：行列が一人分進む（見た目の演出） */
  advanceQueue(): void {
    this.queueOffset = 1;
  }

  private drawScreen(t: number): void {
    const g = this.screenCanvas.getContext('2d')!;
    const W = this.screenCanvas.width;
    const H = this.screenCanvas.height;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#2a0d06');
    grd.addColorStop(1, '#120404');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // 紋章
    g.save();
    g.translate(170, H / 2);
    g.strokeStyle = '#ffb35c';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(0, 0, 100, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + t * 0.2;
      g.beginPath();
      g.moveTo(Math.cos(a) * 100, Math.sin(a) * 100);
      g.lineTo(Math.cos(a) * 124, Math.sin(a) * 124);
      g.stroke();
    }
    // 目
    g.fillStyle = '#ffb35c';
    g.beginPath();
    g.ellipse(0, 0, 62, 34, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a0d06';
    g.beginPath();
    g.arc(Math.sin(t * 0.7) * 16, 0, 22, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // スローガン
    const slogan = HALL_SLOGANS[this.sloganIdx % HALL_SLOGANS.length];
    g.fillStyle = '#ffcf8a';
    g.font = `900 110px ${FONT_DISPLAY}`;
    g.textBaseline = 'middle';
    g.shadowColor = '#ff8a3a';
    g.shadowBlur = 24;
    g.fillText(slogan, 330, H / 2 - 40);
    g.shadowBlur = 0;
    g.font = `700 30px ${FONT_JP}`;
    g.fillStyle = '#ff9f5a';
    const sub = PROPAGANDA[(this.sloganIdx * 3) % PROPAGANDA.length];
    g.fillText(sub.length > 26 ? sub.slice(0, 26) + '…' : sub, 334, H / 2 + 60);
    g.font = `400 22px ${FONT_MONO}`;
    g.fillStyle = 'rgba(255,170,90,0.7)';
    g.fillText('CENTRAL FOOD ADMINISTRATION  //  CANTEEN No.07', 334, H - 40);
    // 走査線
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
    this.screenTex.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    this.rainMat.uniforms.uTime.value = time;
    // 稲光
    if (Math.random() < dt * 0.04) this.lightning = 1;
    this.lightning = Math.max(0, this.lightning - dt * 3);
    const fl = this.lightning > 0 ? (Math.sin(time * 60) > 0 ? this.lightning : this.lightning * 0.3) : 0;
    this.rainMat.uniforms.uFlash.value = fl;
    this.flicker.intensity = 1.5 + (Math.random() < 0.03 ? -1.2 : 0) + fl * 14;
    (this.camLight.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(time * 3) > 0.6 ? 5 : 0.3;
    // スクリーン
    this.screenT += dt;
    if (this.screenT > 0.1) {
      this.screenT = 0;
      if (Math.floor(time / 6) !== Math.floor((time - 0.1) / 6)) this.sloganIdx++;
      this.drawScreen(time);
    }
    // 食べる市民
    for (let i = 0; i < this.dinerSeeds.length; i++) {
      const d = this.dinerSeeds[i];
      const bob = Math.sin(time * 1.4 + d.phase);
      this.dummy.position.set(d.x, 0.95 * d.s, d.z);
      this.dummy.rotation.set(0, d.ry, 0);
      this.dummy.scale.setScalar(d.s);
      this.dummy.updateMatrix();
      this.diners.setMatrixAt(i, this.dummy.matrix);
      const nod = Math.max(0, bob) * 0.06;
      this.dummy.position.set(d.x, 1.37 * d.s - nod * 0.5, d.z + (d.ry === 0 ? 1 : -1) * nod * 0.6);
      this.dummy.updateMatrix();
      this.dinerHeads.setMatrixAt(i, this.dummy.matrix);
    }
    this.diners.instanceMatrix.needsUpdate = true;
    this.dinerHeads.instanceMatrix.needsUpdate = true;
    // 行列
    if (this.queueOffset > 0) {
      this.queueOffset = Math.max(0, this.queueOffset - dt * 0.8);
      this.layoutQueue(this.queueOffset);
      this.queueModels.forEach((m) => m.setWalk(this.queueOffset > 0.02 ? 1 : 0));
    }
    for (const m of this.queueModels) m.update(dt, time);
  }
}
