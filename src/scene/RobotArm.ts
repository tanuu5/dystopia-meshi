import * as THREE from 'three';
import { mats, emissive } from './materials.ts';
import { ARM_BASE } from './layout.ts';
import { damp } from '../util/anim.ts';

// 主人公 MEAL-7 の「手」。台座（旋回）→ 肩 → 肘 → 手首（球関節）→ グリッパーの 2 リンク IK。

const L1 = 0.6;
const L2 = 0.56;
const SHOULDER_H = 0.24;
const GRIP_LEN = 0.17;
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qc = new THREE.Quaternion();
/** 角度を -π..π に収める */
export const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

export class RobotArm {
  readonly group = new THREE.Group();
  private yaw = new THREE.Group();
  private shoulder = new THREE.Group();
  private elbow = new THREE.Group();
  private wrist = new THREE.Group();
  private gripRoll = new THREE.Group();
  private fingers: THREE.Group[] = [];
  private rail: THREE.Mesh;
  readonly grip = new THREE.Object3D(); // 持ったものをつける位置
  private leds: THREE.MeshStandardMaterial[] = [];
  private eye: THREE.MeshStandardMaterial;

  /** 目標（手首ではなく、グリッパーの先端のワールド座標） */
  readonly target = new THREE.Vector3();
  private cur = new THREE.Vector3();
  /** グリッパーの向き：-1 = 真下、0 = 水平（前方）、その間 */
  pitchGoal = -Math.PI / 2;
  private pitch = -Math.PI / 2;
  rollGoal = 0;
  private roll = 0;
  /**
   * グリッパーの水平方向の向き（ワールドの atan2(x, z)）。
   * null のあいだは腕の旋回に合わせる。数値を入れると手首をひねってその向きを保つ
   * （持った器が腕の旋回につられて回らない）
   */
  headingGoal: number | null = null;
  private heading = 0;
  private headingLocked = false;
  /** 向きの固定を解いたあと、腕の面へ戻るまでの手首のひねり */
  private swivel = 0;
  openGoal = 0.6;
  private open = 0.6;
  speed = 7;
  private held: THREE.Object3D | null = null;
  ledColor = new THREE.Color('#35e0ff');

  constructor() {
    const M = mats();
    this.group.position.copy(ARM_BASE);
    // 台座
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.06, 40), M.gunmetal);
    base.position.y = 0.03;
    base.castShadow = true;
    this.group.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.006, 8, 48), this.led());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.062;
    this.group.add(ring);
    this.group.add(this.yaw);
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 40), M.plastic);
    turret.position.y = 0.13;
    turret.castShadow = true;
    this.yaw.add(turret);
    const turretCap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.05, 40), M.plasticDark);
    turretCap.position.y = 0.22;
    this.yaw.add(turretCap);

    // 肩
    this.shoulder.position.y = SHOULDER_H;
    this.yaw.add(this.shoulder);
    const shoulderJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.17, 32), M.plasticDark);
    shoulderJoint.rotation.z = Math.PI / 2;
    shoulderJoint.castShadow = true;
    this.shoulder.add(shoulderJoint);
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 8, 32), this.led());
      cap.rotation.y = Math.PI / 2;
      cap.position.x = s * 0.087;
      this.shoulder.add(cap);
    }
    const upper = this.limb(L1, 0.055, 0.045);
    this.shoulder.add(upper);

    // 肘
    this.elbow.position.z = L1;
    this.shoulder.add(this.elbow);
    const elbowJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.13, 32), M.plasticDark);
    elbowJoint.rotation.z = Math.PI / 2;
    elbowJoint.castShadow = true;
    this.elbow.add(elbowJoint);
    const eRing = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.005, 8, 32), this.led());
    eRing.rotation.y = Math.PI / 2;
    eRing.position.x = 0.067;
    this.elbow.add(eRing);
    const fore = this.limb(L2, 0.043, 0.036);
    this.elbow.add(fore);

    // 手首
    this.wrist.position.z = L2;
    this.elbow.add(this.wrist);
    const wristJoint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 16), M.plasticDark);
    wristJoint.castShadow = true;
    this.wrist.add(wristJoint);
    this.wrist.add(this.gripRoll);
    const palm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.07, 24), M.plastic);
    palm.rotation.x = Math.PI / 2;
    palm.position.z = 0.055;
    palm.castShadow = true;
    this.gripRoll.add(palm);
    // 「目」：手のひらのカメラ
    this.eye = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#35e0ff', emissiveIntensity: 3 });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 24), this.eye);
    lens.position.set(0, 0, 0.0915);
    this.gripRoll.add(lens);
    const lensRim = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.004, 8, 24), M.blackMetal);
    lensRim.position.copy(lens.position);
    this.gripRoll.add(lensRim);
    // 指（2 本）
    for (const s of [-1, 1]) {
      const f = new THREE.Group();
      f.position.set(s * 0.028, 0, 0.09);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.03, 0.085), M.gunmetal);
      seg.position.z = 0.04;
      seg.castShadow = true;
      f.add(seg);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.026, 0.035), M.rubber);
      pad.position.set(-s * 0.008, 0, 0.065);
      f.add(pad);
      this.gripRoll.add(f);
      this.fingers.push(f);
    }
    // 指の付け根をつなぐ伸縮レール。ふだんは手のひらに隠れ、カップを胴から挟むほど開くと見える
    this.rail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.012, 0.02), M.gunmetal);
    this.rail.position.z = 0.08;
    this.gripRoll.add(this.rail);
    this.grip.position.set(0, 0, GRIP_LEN);
    this.gripRoll.add(this.grip);

    // 休止姿勢
    this.target.copy(ARM_BASE).add(new THREE.Vector3(-0.3, 0.75, 0.25));
    this.cur.copy(this.target);
    this.heading = this.tipYaw();
    this.solve();
  }

  private led(): THREE.MeshStandardMaterial {
    const m = emissive('#35e0ff', 2);
    this.leds.push(m);
    return m;
  }

  private limb(len: number, r0: number, r1: number): THREE.Group {
    const M = mats();
    const g = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry((r0 + r1) / 2, len * 0.72, 6, 20), M.plastic);
    shell.rotation.x = Math.PI / 2;
    shell.position.z = len / 2;
    shell.scale.set(1, 1, 1.12);
    shell.castShadow = true;
    shell.receiveShadow = true;
    g.add(shell);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, len * 0.55), this.led());
    stripe.position.set(0, (r0 + r1) / 2 + 0.002, len / 2);
    g.add(stripe);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, len * 0.8, 8), M.rubber);
    cable.rotation.x = Math.PI / 2;
    cable.position.set(-(r0 + r1) / 2 - 0.006, -0.01, len / 2);
    g.add(cable);
    return g;
  }

  /** 物をつかむ（ワールド位置を保ったまま手に移す） */
  attach(obj: THREE.Object3D): void {
    this.held = obj;
    this.grip.attach(obj);
  }

  /** 物を放す（シーンの parent へ戻す） */
  release(parent: THREE.Object3D): THREE.Object3D | null {
    const o = this.held;
    if (o) parent.attach(o);
    this.held = null;
    return o;
  }

  get holding(): THREE.Object3D | null {
    return this.held;
  }

  /** 先端の現在位置 */
  tip(): THREE.Vector3 {
    return this.grip.getWorldPosition(new THREE.Vector3());
  }

  setMood(color: THREE.ColorRepresentation): void {
    this.ledColor.set(color);
  }

  /** 台座から見た先端の方角 */
  private tipYaw(): number {
    return Math.atan2(this.cur.x - this.group.position.x, this.cur.z - this.group.position.z);
  }

  /** 目標の位置と姿勢にほぼ追いついたか */
  settled(eps = 0.002): boolean {
    const headingOk = this.headingGoal === null || Math.abs(wrapAngle(this.headingGoal - this.heading)) < 0.01;
    return this.cur.distanceTo(this.target) < eps && Math.abs(this.pitchGoal - this.pitch) < 0.01 && Math.abs(this.rollGoal - this.roll) < 0.01 && headingOk;
  }

  private solve(): void {
    // 手首の位置 = 先端から、グリッパーの向き（heading と pitch）の逆へ GRIP_LEN
    const pitch = this.pitch;
    const base = this.group.position;
    const h = this.heading;
    const cp = Math.cos(pitch);
    const wx = this.cur.x - base.x - Math.sin(h) * cp * GRIP_LEN;
    const wz = this.cur.z - base.z - Math.cos(h) * cp * GRIP_LEN;
    let yawAng = Math.atan2(wx, wz);
    // 垂直面での手首位置。手首が台座の軸をはさんで先端と反対側にあるときは、先端の側を向いたまま
    // 手首を手前へ引き寄せる（腕が後ろ向きに折れて肘が前や下へ張り出す姿勢にしない）
    let wr = Math.hypot(wx, wz);
    if (wx * (this.cur.x - base.x) + wz * (this.cur.z - base.z) < 0) {
      yawAng = wrapAngle(yawAng + Math.PI);
      wr = -wr;
    }
    this.yaw.rotation.y = yawAng;
    const wy = this.cur.y - base.y - SHOULDER_H - Math.sin(pitch) * GRIP_LEN;
    let d = Math.hypot(wr, wy);
    d = Math.min(L1 + L2 - 0.001, Math.max(Math.abs(L1 - L2) + 0.01, d));
    const cosE = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
    const bend = Math.PI - Math.acos(THREE.MathUtils.clamp(cosE, -1, 1));
    const a1 = Math.atan2(wy, wr) + Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const a2 = a1 - bend;
    // 回転（+X 軸回りの正の回転で +Z が下を向く）
    this.shoulder.rotation.x = -a1;
    this.elbow.rotation.x = bend;
    // 手首（球関節）：前腕の向きを戻す → 水平の向きへひねる → 傾ける
    qa.setFromAxisAngle(AX, a2);
    qb.setFromAxisAngle(AY, wrapAngle(h - yawAng));
    qc.setFromAxisAngle(AX, -pitch);
    this.wrist.quaternion.copy(qa).multiply(qb).multiply(qc);
  }

  update(dt: number, time: number): void {
    this.cur.lerp(this.target, damp(this.speed, dt));
    this.pitch += (this.pitchGoal - this.pitch) * damp(this.speed, dt);
    this.roll += (this.rollGoal - this.roll) * damp(6, dt);
    this.open += (this.openGoal - this.open) * damp(10, dt);
    const tipYaw = this.tipYaw();
    if (this.headingGoal !== null) {
      if (!this.headingLocked) {
        this.heading = tipYaw + this.swivel;
        this.headingLocked = true;
      }
      this.heading += wrapAngle(this.headingGoal - this.heading) * damp(this.speed, dt);
    } else {
      if (this.headingLocked) {
        this.swivel = wrapAngle(this.heading - tipYaw);
        this.headingLocked = false;
      }
      this.swivel *= 1 - damp(4, dt);
      this.heading = tipYaw + this.swivel;
    }
    this.solve();
    this.gripRoll.rotation.z = this.roll;
    const fx = 0.012 + this.open * 0.05;
    this.fingers[0].position.x = -fx;
    this.fingers[1].position.x = fx;
    this.rail.scale.x = fx * 2 + 0.014;
    const pulse = 1.6 + Math.sin(time * 2.2) * 0.5;
    for (const m of this.leds) {
      m.emissive.lerp(this.ledColor, damp(4, dt));
      m.emissiveIntensity = pulse;
    }
    this.eye.emissive.lerp(this.ledColor, damp(4, dt));
    this.eye.emissiveIntensity = 2.5 + Math.sin(time * 5) * 0.5;
  }
}
