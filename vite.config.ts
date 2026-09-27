import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 開発時だけ使うスクリーンショット保存用のエンドポイント（POST /__shot?name=xxx に dataURL を送る）
function devShots(): Plugin {
  return {
    name: 'dev-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url ?? '', 'http://localhost');
        const name = (url.searchParams.get('name') ?? 'shot').replace(/[^\w-]/g, '_');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          const dir = resolve(import.meta.dirname, '.shots');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${name}.png`), Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

// 圧縮で消える同梱ライブラリのライセンス表記を、出力の先頭に付け直す
const BANNER = '/*! ディストピア飯 (c) 2026 たぬ | MIT License\n * Includes three.js (https://threejs.org/) Copyright 2010-2025 Three.js Authors | MIT License */';
function licenseBanner(): Plugin {
  return {
    name: 'license-banner',
    apply: 'build',
    generateBundle(_opts, bundle) {
      for (const f of Object.values(bundle)) if (f.type === 'chunk') f.code = `${BANNER}\n${f.code}`;
    },
  };
}

// base: './' にしておくと GitHub Pages などのサブパスにそのまま置ける
export default defineConfig({
  base: './',
  plugins: [devShots(), licenseBanner()],
  server: { port: 5192, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1800 },
});
