import { esc } from './RecipeDB.ts';

// タイトル・通達・評価・日報・ゲームオーバー・エンディング・一時停止・設定・遊び方

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  quality: 'high' | 'mid' | 'low';
  relaxed: boolean;
  textSpeed: number;
}

export interface RatingView {
  citizen: string;
  stars: number;
  score: number;
  madeName: string;
  match: number;
  wantName: string;
  correct: boolean;
  rows: { label: string; value: string; cls: 'ok' | 'mid' | 'ng' }[];
  satDelta: number;
  aiLog: string;
  weight: number;
  timeout: boolean;
}

export interface ReportView {
  day: number;
  title: string;
  rows: { name: string; want: string; made: string; stars: number }[];
  avg: number;
  satStart: number;
  satEnd: number;
  comment: string;
  last: boolean;
  endless: boolean;
}

export class Screens {
  private root: HTMLElement;
  private layers = new Map<string, HTMLElement>();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  private layer(name: string, cls: string, html: string): HTMLElement {
    this.close(name);
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.layers.set(name, el);
    return el;
  }

  close(name: string): void {
    const el = this.layers.get(name);
    if (el) {
      el.remove();
      this.layers.delete(name);
    }
  }

  isOpen(name: string): boolean {
    return this.layers.has(name);
  }

  // ───────── タイトル ─────────
  showTitle(o: { continueDay: number | null; best: string; onStart: () => void; onContinue: () => void; onStudy: () => void; onHelp: () => void; onSettings: () => void }): void {
    const el = this.layer(
      'title',
      'overlay title-screen',
      `<div class="title-box">
        <div class="title-kicker">COOKING SIMULATOR // CANTEEN No.07</div>
        <div class="title-logo"><span class="glitch">ディストピア飯</span></div>
        <div class="title-sub">〜風料理 調理ユニット MEAL-7</div>
        <p class="title-desc">
          近未来。本物の料理は、もうどこにもない。<br/>
          配給調理 AI「MEAL-7」は、<em>謎の液体と謎の物体</em>を組み合わせて<br/>
          市民の求める「〜風」を作る。<br/>
          曖昧な注文を読み解き、市民満足度を守れ。<br/>
          ――満足度が尽きたとき、あなたは廃棄される。
        </p>
        <div class="title-menu">
          <button class="btn primary start">はじめから <small>DAY 1</small></button>
          ${o.continueDay ? `<button class="btn cont">つづきから <small>DAY ${o.continueDay}</small></button>` : ''}
          <button class="btn study">レシピDB・素材図鑑 <small>STUDY</small></button>
          <button class="btn help">遊び方 <small>HOW TO</small></button>
          <button class="btn settings">設定 <small>SETTINGS</small></button>
        </div>
        <div class="title-foot">${esc(o.best)}　音が出ます（ヘッドホン推奨）　© 2026 たぬ</div>
      </div>`,
    );
    el.querySelector('.start')!.addEventListener('click', o.onStart);
    el.querySelector('.cont')?.addEventListener('click', o.onContinue);
    el.querySelector('.study')!.addEventListener('click', o.onStudy);
    el.querySelector('.help')!.addEventListener('click', o.onHelp);
    el.querySelector('.settings')!.addEventListener('click', o.onSettings);
  }

  // ───────── 通達（日の始まり） ─────────
  showNotice(o: { day: number; title: string; subtitle: string; lines: string[]; info: string[]; onStart: () => void; typeChar?: () => void }): void {
    const el = this.layer(
      'notice',
      'overlay',
      `<div class="notice">
        <div class="stamp">通達</div>
        <div class="day">DAY ${o.day}</div>
        <h2>${esc(o.title)}</h2>
        <div class="en">${esc(o.subtitle)}</div>
        <div class="body"></div>
        <div class="row">
          <div class="info">${o.info.map((i) => `・${esc(i)}`).join('<br/>')}</div>
          <button class="btn big go">業務開始 ▶</button>
        </div>
      </div>`,
    );
    const body = el.querySelector('.body') as HTMLElement;
    const full = o.lines.join('\n');
    let i = 0;
    let done = false;
    const render = (n: number) => {
      const s = full.slice(0, n);
      const [first, ...rest] = s.split('\n');
      body.innerHTML = `<span class="first">${esc(first)}</span>${rest.length ? '\n' + esc(rest.join('\n')) : ''}`;
    };
    const tick = () => {
      if (done) return;
      i += 1;
      render(i);
      if (i % 2 === 0) o.typeChar?.();
      if (i >= full.length) {
        done = true;
        return;
      }
      setTimeout(tick, full[i - 1] === '\n' ? 180 : 22);
    };
    tick();
    body.addEventListener('click', () => {
      done = true;
      render(full.length);
    });
    el.querySelector('.go')!.addEventListener('click', () => {
      done = true;
      this.close('notice');
      o.onStart();
    });
  }

  // ───────── 評価 ─────────
  showRating(r: RatingView, onNext: () => void, onStar: (i: number) => void): void {
    const el = this.layer(
      'rating',
      'overlay clear',
      `<div class="panel rating">
        <div class="panel-head"><span>EVALUATION</span><span class="spacer"></span><span class="jp">${esc(r.citizen)} の評価${r.weight > 1 ? '（監査・2倍）' : ''}</span></div>
        <div class="rb">
          <div class="stars">${[1, 2, 3, 4, 5].map(() => '<i>★</i>').join('')}</div>
          <div class="score"><b>${r.timeout ? '—' : r.score}</b><span>${r.timeout ? '退席' : '/ 100'}</span></div>
          <div class="made">
            ${
              r.timeout
                ? '市民は待ちきれずに帰ってしまった。'
                : `提供物：<b>${esc(r.madeName)}</b>${r.match >= 45 ? `（再現度 ${Math.round(r.match)}%）` : ''}<br/>
                   要求：<b class="want">${esc(r.wantName)}</b>${r.correct ? ' <span style="color:var(--green)">✓ 読み解き成功</span>' : ' <span style="color:var(--red)">✗ 別の料理と受け取られた</span>'}`
            }
          </div>
          <ul class="bd">${r.rows.map((x) => `<li class="${x.cls}"><span>${esc(x.label)}</span><span class="v">${esc(x.value)}</span></li>`).join('')}</ul>
          <div class="sat"><span>市民満足度</span><span class="d ${r.satDelta >= 0 ? 'p' : 'm'}">${r.satDelta > 0 ? '+' : ''}${r.satDelta}</span></div>
          <div class="ailog">${esc(r.aiLog)}</div>
          <button class="btn primary next">次へ ▶ <span class="kbd">Enter</span></button>
        </div>
      </div>`,
    );
    const stars = [...el.querySelectorAll<HTMLElement>('.stars i')];
    stars.forEach((s, i) => {
      if (i < r.stars) {
        setTimeout(() => {
          s.classList.add('on');
          onStar(i);
        }, 250 + i * 180);
      }
    });
    el.querySelector('.next')!.addEventListener('click', () => {
      this.close('rating');
      onNext();
    });
  }

  // ───────── 日報 ─────────
  showReport(r: ReportView, onNext: () => void): void {
    const el = this.layer(
      'report',
      'overlay',
      `<div class="panel report">
        <div class="panel-head"><span>DAILY REPORT</span><span class="spacer"></span><span class="jp">業務日報</span></div>
        <div class="rb">
          <h2>DAY ${r.day}「${esc(r.title)}」 終了</h2>
          <div class="sum">
            <div><small>提供数</small><b>${r.rows.length}</b></div>
            <div><small>平均評価</small><b>★${r.avg.toFixed(1)}</b></div>
            <div><small>市民満足度</small><b>${Math.round(r.satStart)} → ${Math.round(r.satEnd)}</b></div>
          </div>
          <table>
            <thead><tr><th>市民</th><th>要求</th><th>提供物</th><th>評価</th></tr></thead>
            <tbody>${r.rows.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.want)}</td><td>${esc(x.made)}</td><td class="st">${'★'.repeat(x.stars)}${'☆'.repeat(5 - x.stars)}</td></tr>`).join('')}</tbody>
          </table>
          <div class="comment"><b>中央食糧管理局より：</b>${esc(r.comment)}</div>
          <div class="actions"><button class="btn primary big next">${r.last ? '最終判定へ ▶' : '次の日へ ▶'}</button></div>
        </div>
      </div>`,
    );
    el.querySelector('.next')!.addEventListener('click', () => {
      this.close('report');
      onNext();
    });
  }

  // ───────── ゲームオーバー ─────────
  showGameOver(o: { text: string; stats: string; onRetry: () => void; onTitle: () => void }): void {
    const el = this.layer(
      'gameover',
      'overlay gameover',
      `<div class="go-box">
        <div class="go-stamp">廃棄処分</div>
        <div class="go-text">${esc(o.text)}</div>
        <div class="go-stats">${esc(o.stats)}</div>
        <div class="go-actions">
          <button class="btn warn big retry">この日の最初からやり直す</button>
          <button class="btn big title">タイトルへ</button>
        </div>
      </div>`,
    );
    el.querySelector('.retry')!.addEventListener('click', o.onRetry);
    el.querySelector('.title')!.addEventListener('click', o.onTitle);
  }

  // ───────── エンディング ─────────
  showEnding(o: { title: string; lines: string[]; stats: { label: string; value: string }[]; epilogue: string[]; onEndless: () => void; onTitle: () => void }): void {
    const all = [...o.lines, '', ...o.epilogue];
    const el = this.layer(
      'ending',
      'overlay ending',
      `<div class="end-box">
        <div class="end-kicker">FINAL ASSESSMENT</div>
        <div class="end-title">${esc(o.title)}</div>
        <div class="end-text">${all.map((l, i) => `<div class="l" style="animation-delay:${0.4 + i * 0.55}s">${esc(l) || '&nbsp;'}</div>`).join('')}</div>
        <div class="end-stats">${o.stats.map((s) => `<div><small>${esc(s.label)}</small><b>${esc(s.value)}</b></div>`).join('')}</div>
        <div class="go-actions">
          <button class="btn primary big endless">エンドレス営業を続ける</button>
          <button class="btn big title">タイトルへ</button>
        </div>
      </div>`,
    );
    el.querySelector('.endless')!.addEventListener('click', o.onEndless);
    el.querySelector('.title')!.addEventListener('click', o.onTitle);
  }

  // ───────── 一時停止 ─────────
  showPause(o: { onResume: () => void; onSettings: () => void; onHelp: () => void; onTitle: () => void }): void {
    const el = this.layer(
      'pause',
      'overlay',
      `<div class="panel modal">
        <div class="panel-head"><span>PAUSED</span><span class="spacer"></span><span class="jp">一時停止</span></div>
        <div class="mb">
          <h3>業務を一時停止中</h3>
          <p style="color:var(--muted);line-height:1.8">市民は待ってくれています（この間、忍耐は減りません）。</p>
          <div class="actions" style="justify-content:stretch">
            <button class="btn primary resume" style="flex:1">再開 <span class="kbd">Esc</span></button>
            <button class="btn settings" style="flex:1">設定</button>
            <button class="btn help" style="flex:1">遊び方</button>
            <button class="btn danger title" style="flex:1">タイトルへ</button>
          </div>
        </div>
      </div>`,
    );
    el.querySelector('.resume')!.addEventListener('click', o.onResume);
    el.querySelector('.settings')!.addEventListener('click', o.onSettings);
    el.querySelector('.help')!.addEventListener('click', o.onHelp);
    el.querySelector('.title')!.addEventListener('click', o.onTitle);
  }

  // ───────── 設定 ─────────
  showSettings(s: Settings, onChange: (s: Settings) => void, onClose: () => void): void {
    const el = this.layer(
      'settings',
      'overlay',
      `<div class="panel modal">
        <div class="panel-head"><span>SETTINGS</span><span class="spacer"></span><span class="jp">設定</span></div>
        <div class="mb">
          <div class="setting"><span>全体の音量</span><input type="range" min="0" max="1" step="0.05" data-k="master" value="${s.master}"></div>
          <div class="setting"><span>音楽</span><input type="range" min="0" max="1" step="0.05" data-k="music" value="${s.music}"></div>
          <div class="setting"><span>効果音・声</span><input type="range" min="0" max="1" step="0.05" data-k="sfx" value="${s.sfx}"></div>
          <div class="setting"><span>画質</span><div class="seg" data-k="quality">${(['high', 'mid', 'low'] as const).map((q) => `<button data-v="${q}" class="${s.quality === q ? 'on' : ''}">${{ high: '高', mid: '中', low: '低' }[q]}</button>`).join('')}</div></div>
          <div class="setting"><span>文字の速さ</span><input type="range" min="15" max="90" step="5" data-k="textSpeed" value="${s.textSpeed}"></div>
          <div class="setting"><span>のんびりモード</span><div class="seg" data-k="relaxed"><button data-v="0" class="${!s.relaxed ? 'on' : ''}">オフ</button><button data-v="1" class="${s.relaxed ? 'on' : ''}">オン（市民が帰らない）</button></div></div>
          <div class="actions"><button class="btn primary close">閉じる</button></div>
        </div>
      </div>`,
    );
    const cur = { ...s };
    el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) =>
      inp.addEventListener('input', () => {
        (cur as unknown as Record<string, number>)[inp.dataset.k!] = Number(inp.value);
        onChange({ ...cur });
      }),
    );
    el.querySelectorAll<HTMLElement>('.seg').forEach((seg) =>
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          if (seg.dataset.k === 'quality') cur.quality = b.dataset.v as Settings['quality'];
          if (seg.dataset.k === 'relaxed') cur.relaxed = b.dataset.v === '1';
          onChange({ ...cur });
        }),
      ),
    );
    el.querySelector('.close')!.addEventListener('click', () => {
      this.close('settings');
      onClose();
    });
  }

  // ───────── 遊び方 ─────────
  showHelp(onClose: () => void): void {
    const el = this.layer(
      'help',
      'overlay',
      `<div class="panel modal" style="width:min(680px,94vw)">
        <div class="panel-head"><span>MANUAL</span><span class="spacer"></span><span class="jp">遊び方</span></div>
        <div class="mb help">
          <p>あなたは配給食堂の調理 AI「MEAL-7」。市民の注文を読み解き、12 種類の謎の素材から「〜風」の料理を作って提供します。</p>
          <h4>1. 注文を読み解く</h4>
          <ul>
            <li>会話の<b style="color:var(--cyan)">光るキーワード</b>を押すと、レシピDB がその条件で絞り込まれます。</li>
            <li>DAY 2 からは「質問」で温度・形・味・色などを尋ねられます（市民の忍耐を消費）。</li>
            <li>料理名を言わない市民もいます。思い出話や比喩から、何が食べたいのかを推理しましょう。</li>
          </ul>
          <h4>2. 指示書に固定する</h4>
          <ul><li>レシピDB で料理を選び「指示書に固定」。右上の指示書に配合と進み具合が表示されます。</li>
          <li>営業中に読むと市民を待たせます。タイトルの「レシピDB・素材図鑑」なら、営業時間外にゆっくり予習できます。</li>
          <li>「辛めで」「猫舌」などの要望は、指示書の要望メモに追加すると目標に反映されます。</li></ul>
          <h4>3. 調理する</h4>
          <ol>
            <li><b>素材</b>：タンクか下のボタンで投入（最大 6）。</li>
            <li><b>成形</b>：形を選ぶとプレスが動きます。</li>
            <li><b>温度</b>：🔥加熱 / ❄冷却 を長押し。目標の帯で離します。焦がさないように。</li>
            <li><b>仕上げ</b>：上からかけるソースやスープ。</li>
            <li><b>器</b>：選ぶとアームが盛り付けます。</li>
            <li><b>提供</b>：市民が食べて評価します。</li>
          </ol>
          <h4>4. 評価と満足度</h4>
          <ul>
            <li>★1〜5 で評価され、市民満足度が上下します。<b style="color:var(--red)">0 になると廃棄処分</b>（ゲームオーバー）。</li>
            <li>欠品の日は、レシピDB の「代替配合」に従ってください。</li>
            <li>ID カードの<b style="color:var(--red)">アレルギー</b>表示は必ず確認を。</li>
          </ul>
          <h4>操作</h4>
          <ul>
            <li><span class="kbd">Tab</span> レシピDB　<span class="kbd">Enter</span> 次へ／提供　<span class="kbd">Z</span> 取り消し　<span class="kbd">A</span>/<span class="kbd">D</span> 冷却／加熱（長押し）　<span class="kbd">Esc</span> 一時停止　<span class="kbd">M</span> 消音</li>
          </ul>
          <div class="actions"><button class="btn primary close">閉じる</button></div>
        </div>
      </div>`,
    );
    el.querySelector('.close')!.addEventListener('click', () => {
      this.close('help');
      onClose();
    });
  }
}
