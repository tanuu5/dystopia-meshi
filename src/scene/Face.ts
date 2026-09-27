import * as THREE from 'three';
import type { Look } from '../data/characters.ts';

// 顔をキャンバスに描く。頭の前面に貼る球面パッチのテクスチャになる。

export type Eyes = 'open' | 'closed' | 'happy' | 'wide' | 'sad' | 'angry' | 'half' | 'dizzy';
export type Mouth = 'neutral' | 'smile' | 'grin' | 'o' | 'frown' | 'wavy' | 'open' | 'chew' | 'teeth' | 'small';
export type Brows = 'neutral' | 'up' | 'down' | 'worried' | 'tilt';

export interface Expression {
  eyes: Eyes;
  mouth: Mouth;
  brows: Brows;
  blush: number;
  sweat: boolean;
  tear: boolean;
  lookX: number;
  lookY: number;
}

export const EXPRESSIONS: Record<string, Partial<Expression>> = {
  neutral: { eyes: 'open', mouth: 'neutral', brows: 'neutral' },
  happy: { eyes: 'open', mouth: 'smile', brows: 'up', blush: 0.4 },
  delight: { eyes: 'happy', mouth: 'grin', brows: 'up', blush: 0.8 },
  confused: { eyes: 'open', mouth: 'wavy', brows: 'tilt' },
  sad: { eyes: 'sad', mouth: 'frown', brows: 'worried', tear: true },
  angry: { eyes: 'angry', mouth: 'teeth', brows: 'down' },
  shock: { eyes: 'wide', mouth: 'o', brows: 'up', sweat: true },
  think: { eyes: 'half', mouth: 'small', brows: 'tilt' },
  sleepy: { eyes: 'half', mouth: 'small', brows: 'neutral' },
  chew: { eyes: 'happy', mouth: 'chew', brows: 'neutral' },
};

export const FACE_W = 320;
export const FACE_H = 256;

export class FaceCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private look: Look;
  private key = '';

  constructor(look: Look) {
    this.look = look;
    this.canvas = document.createElement('canvas');
    this.canvas.width = FACE_W;
    this.canvas.height = FACE_H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  draw(e: Expression, talkOpen: number, blink: boolean): void {
    const key = `${e.eyes}|${e.mouth}|${e.brows}|${e.blush.toFixed(1)}|${e.sweat}|${e.tear}|${talkOpen.toFixed(1)}|${blink}|${e.lookX.toFixed(2)}|${e.lookY.toFixed(2)}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    const L = this.look;
    g.clearRect(0, 0, FACE_W, FACE_H);
    const cx = FACE_W / 2;
    const eyeY = 108;
    const eyeDX = L.body === 'child' ? 56 : 50;
    const ink = '#1c1614';
    const size = L.eyes === 'big' ? 1.25 : L.eyes === 'narrow' ? 0.8 : 1;
    const lx = e.lookX * 5;
    const ly = e.lookY * 4;

    // 頬
    if (e.blush > 0.01 || L.cheek) {
      const b = Math.max(e.blush, L.cheek ? 0.35 : 0);
      for (const s of [-1, 1]) {
        const grd = g.createRadialGradient(cx + s * 70, 146, 0, cx + s * 70, 146, 30);
        grd.addColorStop(0, `rgba(240,110,120,${0.55 * b})`);
        grd.addColorStop(1, 'rgba(240,110,120,0)');
        g.fillStyle = grd;
        g.fillRect(cx + s * 70 - 34, 112, 68, 68);
      }
    }
    // 目の下のくま
    if (L.eyebags) {
      g.strokeStyle = 'rgba(90,60,80,0.35)';
      g.lineWidth = 3;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(cx + s * eyeDX, eyeY + 12, 16, 0.15 * Math.PI, 0.85 * Math.PI);
        g.stroke();
      }
    }
    // 無精ひげ
    if (L.beard) {
      g.fillStyle = 'rgba(40,30,25,0.35)';
      for (let i = 0; i < 90; i++) {
        const a = fract(Math.sin(i * 12.9898) * 43758.5453) * Math.PI;
        const r = 40 + fract(Math.sin(i * 78.233) * 43758.5453) * 22;
        g.fillRect(cx + Math.cos(a) * r * 1.1, 150 + Math.sin(a) * r * 0.9, 2, 2);
      }
    }

    // 目
    const eyes = blink && e.eyes !== 'happy' && e.eyes !== 'dizzy' ? 'closed' : e.eyes;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of [-1, 1]) {
      const x = cx + s * eyeDX + lx;
      const y = eyeY + ly;
      g.fillStyle = ink;
      g.strokeStyle = ink;
      g.lineWidth = 5;
      switch (eyes) {
        case 'closed':
          g.beginPath();
          g.moveTo(x - 14, y + 2);
          g.quadraticCurveTo(x, y + 9, x + 14, y + 2);
          g.stroke();
          break;
        case 'happy':
          g.beginPath();
          g.moveTo(x - 15, y + 6);
          g.quadraticCurveTo(x, y - 13, x + 15, y + 6);
          g.stroke();
          break;
        case 'half':
          g.beginPath();
          g.ellipse(x, y + 3, 12 * size, 8 * size, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = L.skin;
          g.fillRect(x - 17, y - 14, 34, 14);
          g.strokeStyle = ink;
          g.lineWidth = 4;
          g.beginPath();
          g.moveTo(x - 15, y);
          g.lineTo(x + 15, y);
          g.stroke();
          break;
        case 'dizzy':
          g.lineWidth = 3;
          g.beginPath();
          for (let a = 0; a < Math.PI * 5; a += 0.3) g.lineTo(x + Math.cos(a) * a * 1.5, y + Math.sin(a) * a * 1.5);
          g.stroke();
          break;
        default: {
          const w = (eyes === 'wide' ? 18 : 14.5) * size;
          const h = (eyes === 'wide' ? 24 : eyes === 'sad' ? 15 : 19.5) * size * (L.eyes === 'sleepy' ? 0.7 : 1);
          g.beginPath();
          g.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
          g.fill();
          // ハイライト
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(x - w * 0.3, y - h * 0.35, w * 0.32, 0, Math.PI * 2);
          g.fill();
          g.beginPath();
          g.arc(x + w * 0.35, y + h * 0.3, w * 0.14, 0, Math.PI * 2);
          g.fill();
          if (L.eyes === 'sleepy' && eyes === 'open') {
            g.fillStyle = 'rgba(0,0,0,0)';
            g.strokeStyle = ink;
            g.lineWidth = 3.5;
            g.beginPath();
            g.moveTo(x - 15, y - h * 0.55);
            g.lineTo(x + 15, y - h * 0.55);
            g.stroke();
          }
          if (eyes === 'angry') {
            g.fillStyle = L.skin;
            g.beginPath();
            g.moveTo(x - 19, y - 19);
            g.lineTo(x + 19, y - 19);
            g.lineTo(x + s * 19, y - 2);
            g.closePath();
            g.fill();
          }
        }
      }
    }

    // 眉
    g.strokeStyle = shade(L.hair, L.hairStyle === 'bald' ? 0.6 : 0.8);
    g.lineWidth = L.brows === 'thick' ? 7 : L.brows === 'thin' ? 3 : 5;
    for (const s of [-1, 1]) {
      const x = cx + s * eyeDX;
      const y = eyeY - 40;
      let inner = 0;
      let outer = 0;
      switch (e.brows) {
        case 'up':
          inner = -6;
          outer = -4;
          break;
        case 'down':
          inner = 7;
          outer = -5;
          break;
        case 'worried':
          inner = -7;
          outer = 5;
          break;
        case 'tilt':
          inner = s < 0 ? -6 : 3;
          outer = s < 0 ? -8 : 2;
          break;
      }
      g.beginPath();
      g.moveTo(x - s * 6, y + inner);
      g.quadraticCurveTo(x + s * 8, y - 5 + (inner + outer) / 2, x + s * 21, y + outer);
      g.stroke();
    }

    // 口
    const my = 172;
    g.strokeStyle = '#5a2a24';
    g.fillStyle = '#6a2a28';
    g.lineWidth = 4.5;
    let mouth = e.mouth;
    if (talkOpen > 0.5 && (mouth === 'neutral' || mouth === 'smile' || mouth === 'small' || mouth === 'frown')) mouth = 'open';
    switch (mouth) {
      case 'neutral':
        g.beginPath();
        g.moveTo(cx - 12, my);
        g.quadraticCurveTo(cx, my + 3, cx + 12, my);
        g.stroke();
        break;
      case 'small':
        g.beginPath();
        g.moveTo(cx - 6, my);
        g.lineTo(cx + 6, my);
        g.stroke();
        break;
      case 'smile':
        g.beginPath();
        g.moveTo(cx - 18, my - 4);
        g.quadraticCurveTo(cx, my + 14, cx + 18, my - 4);
        g.stroke();
        break;
      case 'grin':
        g.beginPath();
        g.moveTo(cx - 22, my - 6);
        g.quadraticCurveTo(cx, my + 26, cx + 22, my - 6);
        g.closePath();
        g.fill();
        g.fillStyle = '#e86a6a';
        g.beginPath();
        g.ellipse(cx, my + 8, 10, 5, 0, 0, Math.PI * 2);
        g.fill();
        break;
      case 'o':
        g.beginPath();
        g.ellipse(cx, my + 2, 8, 11, 0, 0, Math.PI * 2);
        g.fill();
        break;
      case 'open':
        g.beginPath();
        g.ellipse(cx, my + 2, 11, 5 + talkOpen * 5, 0, 0, Math.PI * 2);
        g.fill();
        break;
      case 'frown':
        g.beginPath();
        g.moveTo(cx - 16, my + 6);
        g.quadraticCurveTo(cx, my - 8, cx + 16, my + 6);
        g.stroke();
        break;
      case 'wavy':
        g.beginPath();
        g.moveTo(cx - 16, my);
        for (let i = 0; i <= 8; i++) g.lineTo(cx - 16 + i * 4, my + (i % 2 ? -3 : 3));
        g.stroke();
        break;
      case 'chew': {
        const k = talkOpen;
        g.beginPath();
        g.moveTo(cx - 12, my + k * 3);
        g.quadraticCurveTo(cx, my - 5 + k * 6, cx + 12, my + k * 3);
        g.stroke();
        break;
      }
      case 'teeth':
        g.beginPath();
        g.rect(cx - 16, my - 5, 32, 12);
        g.fill();
        g.fillStyle = '#f2efe8';
        g.fillRect(cx - 14, my - 3, 28, 8);
        g.strokeStyle = '#6a2a28';
        g.lineWidth = 2;
        for (let i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(cx + i * 7, my - 3);
          g.lineTo(cx + i * 7, my + 5);
          g.stroke();
        }
        break;
    }

    // 汗・涙
    if (e.sweat) {
      g.fillStyle = 'rgba(140,200,255,0.9)';
      g.beginPath();
      g.moveTo(cx + 78, 70);
      g.quadraticCurveTo(cx + 90, 96, cx + 78, 100);
      g.quadraticCurveTo(cx + 66, 96, cx + 78, 70);
      g.fill();
    }
    if (e.tear) {
      g.fillStyle = 'rgba(140,200,255,0.85)';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(cx + s * eyeDX + s * 4, eyeY + 24, 4, 9, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.texture.needsUpdate = true;
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/** 頭の上に出る感情マーク（！・？・♪ など） */
const emoteCache = new Map<string, THREE.CanvasTexture>();
export function emoteTexture(sym: string, color: string): THREE.CanvasTexture {
  const key = sym + color;
  const hit = emoteCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = `900 92px "Zen Kaku Gothic New", "Hiragino Sans", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = 'rgba(10,12,16,0.85)';
  g.strokeText(sym, 64, 68);
  g.fillStyle = color;
  g.fillText(sym, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  emoteCache.set(key, t);
  return t;
}
