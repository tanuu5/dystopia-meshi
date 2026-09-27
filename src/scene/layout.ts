import * as THREE from 'three';

// 厨房の配置（メートル）。カメラは +Z 側から -Z を見る。

export const COUNTER_Y = 0.92;
/** 配膳口のある壁（厨房側の面と客席側の面） */
export const WALL_Z = -0.62;
export const WALL_BACK_Z = -0.8;
export const HATCH = { x0: -0.82, x1: 0.82, y0: 0.98, y1: 1.9 };
/** 配膳口の棚（厨房から客席まで通る） */
export const LEDGE_Y = 0.98;

export const PAD = new THREE.Vector3(0, COUNTER_Y, 0.42);
export const PAD_TOP = 0.975;
export const PAD_R = 0.36;
/** 料理が浮かぶ位置 */
export const FOOD_FLOAT = new THREE.Vector3(0, 1.32, 0.42);

/** 厨房側のトレイ待機位置。アームが器の縁を持ったまま無理なく置けるよう、台座から離して左に寄せる */
export const TRAY_KITCHEN = new THREE.Vector3(-0.2, LEDGE_Y, -0.5);
export const TRAY_CUSTOMER = new THREE.Vector3(0, LEDGE_Y, -1.02);
/** トレイ上面（器を置く高さ、トレイの原点から） */
export const TRAY_TOP = 0.022;

export const SEAT = new THREE.Vector3(0, 0, -1.58);

export const ARM_BASE = new THREE.Vector3(0.5, COUNTER_Y, -0.45);
export const ELEVATOR = new THREE.Vector3(0.6, COUNTER_Y, 0.2);

export const DISPENSER_IDLE_Y = 2.55;
export const DISPENSER_ACTIVE_Y = 1.86;

export const TANK_RACKS = [
  { x: -0.9, z: -0.1 },
  { x: 0.9, z: -0.1 },
];
export const TANK_R = 0.072;
export const TANK_H = 0.36;
