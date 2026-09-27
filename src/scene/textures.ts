import * as THREE from 'three';

// キャンバスで作る手続き的なテクスチャ群。画像ファイルは使わない。

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

let seed = 1234;
function rnd(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

/** ヘアライン加工のステンレス（粗さマップ用。横方向の細い筋） */
export function brushedRoughness(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#6a6a6a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const y = rnd() * 512;
    const x = rnd() * 512;
    const len = 40 + rnd() * 300;
    const v = 70 + Math.floor(rnd() * 90);
    g.strokeStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.3})`;
    g.lineWidth = 0.5 + rnd() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y + (rnd() - 0.5) * 1.5);
    g.stroke();
  }
  // 小さな擦り傷と汚れ
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const r = 8 + rnd() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const v = rnd() < 0.5 ? 150 : 40;
    grd.addColorStop(0, `rgba(${v},${v},${v},0.25)`);
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return tex(c, false, [3, 1.5]);
}

/** 壁の金属パネル（色） */
export function wallPanel(base = '#262c33', line = '#11151a'): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  // パネルごとに微妙に色を変える
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const v = (rnd() - 0.5) * 16;
      g.fillStyle = `rgba(${128 + v},${128 + v},${128 + v},0.06)`;
      g.fillRect(px * 256 + 3, py * 256 + 3, 250, 250);
      // 縦の汚れ
      for (let i = 0; i < 6; i++) {
        const x = px * 256 + rnd() * 250;
        const grd = g.createLinearGradient(0, py * 256, 0, py * 256 + 256);
        grd.addColorStop(0, 'rgba(0,0,0,0)');
        grd.addColorStop(1, `rgba(0,0,0,${0.12 + rnd() * 0.12})`);
        g.fillStyle = grd;
        g.fillRect(x, py * 256, 2 + rnd() * 10, 256);
      }
    }
  }
  g.strokeStyle = line;
  g.lineWidth = 5;
  g.strokeRect(0, 0, 512, 512);
  g.beginPath();
  g.moveTo(256, 0);
  g.lineTo(256, 512);
  g.moveTo(0, 256);
  g.lineTo(512, 256);
  g.stroke();
  // リベット
  g.fillStyle = 'rgba(200,210,220,0.35)';
  for (let py = 0; py < 2; py++)
    for (let px = 0; px < 2; px++)
      for (const [ox, oy] of [[14, 14], [242, 14], [14, 242], [242, 242]]) {
        g.beginPath();
        g.arc(px * 256 + ox, py * 256 + oy, 3.2, 0, Math.PI * 2);
        g.fill();
      }
  return tex(c, true, [1, 1]);
}

/** 床タイル */
export function floorTiles(base = '#1a1f24', grout = '#0b0e11', n = 8): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = grout;
  g.fillRect(0, 0, 512, 512);
  const s = 512 / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = (rnd() - 0.5) * 18;
      const col = new THREE.Color(base);
      g.fillStyle = `rgb(${col.r * 255 + v},${col.g * 255 + v},${col.b * 255 + v})`;
      g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
    }
  return tex(c, true, [4, 4]);
}

/** 汎用ノイズ（グレースケール） */
export function noiseTexture(size = 256, contrast = 1): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (rnd() - 0.5) * 255 * contrast;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, false, [1, 1]);
}

/** 黄色と黒の警告ストライプ */
export function hazardStripes(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 32);
  g.fillStyle = '#d9a514';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#121212';
  for (let x = -32; x < 256 + 32; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.closePath();
    g.fill();
  }
  return tex(c, true, [4, 1]);
}

export const FONT_JP = '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", sans-serif';
export const FONT_MONO = '"Share Tech Mono", "M PLUS 1 Code", monospace';
export const FONT_DISPLAY = '"Dela Gothic One", "Zen Kaku Gothic New", sans-serif';

/** 文字の看板（発光用） */
export function signTexture(
  lines: { text: string; size: number; color: string; font?: string; weight?: string }[],
  w: number,
  h: number,
  bg = 'rgba(0,0,0,0)',
  border?: string,
): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.max(2, h * 0.03);
    g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
  }
  const total = lines.reduce((a, l) => a + l.size * 1.25, 0);
  let y = (h - total) / 2;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const l of lines) {
    g.font = `${l.weight ?? '700'} ${l.size}px ${l.font ?? FONT_JP}`;
    g.fillStyle = l.color;
    g.shadowColor = l.color;
    g.shadowBlur = l.size * 0.25;
    g.fillText(l.text, w / 2, y);
    y += l.size * 1.25;
  }
  return tex(c);
}

/** タンクのラベル */
export function labelTexture(code: string, name: string, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#0d1116';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(160,190,210,0.35)';
  g.lineWidth = 3;
  g.strokeRect(4, 4, 248, 120);
  g.fillStyle = color;
  g.fillRect(12, 14, 26, 100);
  g.fillStyle = '#d8e6f0';
  g.font = `700 36px ${FONT_MONO}`;
  g.textBaseline = 'top';
  g.fillText(code, 50, 16);
  g.font = `700 30px ${FONT_JP}`;
  g.fillStyle = '#9fb4c4';
  g.fillText(name, 50, 64);
  return tex(c);
}

/** 管理局のポスター */
export function posterTexture(title: string, sub: string, accent: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 384);
  g.fillStyle = '#d9d2c0';
  g.fillRect(0, 0, 256, 384);
  g.fillStyle = accent;
  g.fillRect(0, 0, 256, 120);
  // 丸い紋章（フォークと歯車）
  g.strokeStyle = '#f1ead6';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(128, 62, 38, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 38, 62 + Math.sin(a) * 38);
    g.lineTo(128 + Math.cos(a) * 48, 62 + Math.sin(a) * 48);
    g.stroke();
  }
  g.fillStyle = '#f1ead6';
  g.fillRect(124, 36, 8, 52);
  for (let i = -1; i <= 1; i++) g.fillRect(128 + i * 10 - 2, 36, 4, 20);
  g.fillStyle = '#1c1c1c';
  g.textAlign = 'center';
  g.font = `900 44px ${FONT_DISPLAY}`;
  const chars = [...title];
  const per = chars.length > 5 ? Math.ceil(chars.length / 2) : chars.length;
  g.fillText(chars.slice(0, per).join(''), 128, 188);
  if (chars.length > per) g.fillText(chars.slice(per).join(''), 128, 240);
  g.font = `700 20px ${FONT_JP}`;
  g.fillStyle = '#3a3a3a';
  g.fillText(sub, 128, 300);
  g.font = `400 14px ${FONT_MONO}`;
  g.fillText('CENTRAL FOOD ADMINISTRATION', 128, 350);
  // 経年の汚れ
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 256;
    const y = rnd() * 384;
    const r = 5 + rnd() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(60,50,30,0.18)');
    grd.addColorStop(1, 'rgba(60,50,30,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return tex(c);
}

/** 放射状のぼかし（光のにじみ・接地影に使う） */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return tex(c, false);
}

/** 調理台の円形ステージの模様 */
export function padTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#20262d';
  g.fillRect(0, 0, 512, 512);
  g.translate(256, 256);
  for (let r = 60; r < 250; r += 38) {
    g.strokeStyle = `rgba(120,200,230,${0.08 + (r / 250) * 0.12})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const long = i % 6 === 0;
    g.strokeStyle = long ? 'rgba(140,220,255,0.55)' : 'rgba(140,220,255,0.22)';
    g.lineWidth = long ? 3 : 1.5;
    g.beginPath();
    g.moveTo(Math.cos(a) * (long ? 214 : 226), Math.sin(a) * (long ? 214 : 226));
    g.lineTo(Math.cos(a) * 244, Math.sin(a) * 244);
    g.stroke();
  }
  g.font = `400 20px ${FONT_MONO}`;
  g.fillStyle = 'rgba(140,220,255,0.5)';
  g.textAlign = 'center';
  g.fillText('MEAL-7 // FORMING STAGE', 0, -150);
  g.fillText('ANTI-GRAVITY FIELD 0.82G', 0, 164);
  return tex(c);
}

/** 走査線つきのホログラム（封じ込め場のシリンダー） */
export function holoTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 256);
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    const line = y % 32 < 2 ? 1 : 0.12;
    // キャンバスの下端が円筒の下（台に近いほど明るい）
    const fade = Math.pow(y / 256, 1.8);
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const v = 255 * line * fade;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
