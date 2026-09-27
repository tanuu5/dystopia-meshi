import type { Evaluation } from './scoring.ts';
import type { ActiveOrder } from './orders.ts';
import { AI_LOG, ING_LINE_WRAP, ING_TASTE, ISSUE_LINES, STAR_LINES } from '../data/lines.ts';
import { FORM, heatIndex } from '../data/processes.ts';
import { MODIFIERS } from '../data/modifiers.ts';
import { pick } from '../util/rng.ts';

export type Mood = 'delight' | 'happy' | 'neutral' | 'confused' | 'sad' | 'angry' | 'shock';

export interface Reaction {
  lines: string[];
  mood: Mood;
  aiLog: string;
}

function fill(s: string, ev: Evaluation): string {
  const want = ev.target.base;
  const made = ev.identity?.base ?? '謎の物体';
  return s.replaceAll('{want}', want).replaceAll('{made}', made).replaceAll('{form}', FORM[ev.made.form].name).replaceAll('{score}', String(ev.score));
}

function heatLineKey(ev: Evaluation): string {
  const mi = heatIndex(ev.made.heat);
  const ii = heatIndex(ev.ideal.heat);
  if (mi < ii) {
    if (ev.made.heat === 'frozen') return 'heatLowFrozen';
    if (ev.made.heat === 'chilled') return 'heatLowCold';
    if (ev.made.heat === 'room') return 'heatLowRoom';
    return 'heatLowWarm';
  }
  if (ev.made.heat === 'hot') return ev.ideal.heat === 'warm' ? 'heatHighHot' : 'heatHighHot';
  if (ev.made.heat === 'warm') return 'heatHighWarm';
  if (ev.made.heat === 'room') return 'heatHighRoom';
  return 'heatHighCold';
}

export function composeReaction(ev: Evaluation, order: ActiveOrder, rng: () => number): Reaction {
  const p = order.citizen.personality;
  const voice = p === 'child' ? 'child' : 'adult';
  const lines: string[] = [];
  const top = ev.issues[0];

  if (ev.timeout) {
    return {
      lines: [pick(rng, ISSUE_LINES.timeout[voice])],
      mood: 'angry',
      aiLog: pick(rng, AI_LOG.timeout),
    };
  }

  // 特別注文
  if (order.special === 'nikujaga') {
    const good = ev.stars >= 4;
    if (ev.specialNotes.length) lines.push(ev.specialNotes.slice(0, 2).join('。') + '。');
    if (ev.stars >= 5) lines.push('……これじゃ。これじゃよ。女房の……。', '……ありがとう。名前を、思い出したよ。「肉じゃが」じゃ。');
    else if (good) lines.push('……近い。ずいぶん近い。', '名前を思い出した。「肉じゃが」じゃ。ありがとうよ。');
    else if (ev.stars === 3) lines.push('ふむ……どこか、懐かしい気もする。', '無理を言ってすまんかったな。');
    else lines.push('……いや、ええんじゃ。無いものは無い。', '無理を言ってすまんかった。');
    return {
      lines,
      mood: ev.stars >= 4 ? 'delight' : ev.stars === 3 ? 'neutral' : 'sad',
      aiLog: ev.stars >= 4 ? '新規レシピを登録：「肉じゃが風（イワサキ家の味）」。' : '要求の再構成に失敗。記憶データが不足している。',
    };
  }
  if (order.special === 'free') {
    const madeName = ev.identity?.base;
    if (ev.burnt) lines.push('まっくろ！ …AI さん、こげたのがすきなの？', 'でも、AI さんのすきなものなら、ミナもすき！');
    else if (madeName && ev.score >= 90) lines.push(`${madeName}！ AI さんは、${madeName}がすきなんだね！`, 'ミナもだいすきになった！ ずっとわすれないよ！');
    else if (madeName) lines.push(`これ、${madeName}？ AI さんのすきなあじ、ふしぎなあじ！`, 'でも、おいしい！ ありがとう！');
    else lines.push('ふしぎなあじ！ これ、なんていうたべもの？', 'AI さんのすきなものなら、ミナもすき！');
    return {
      lines,
      mood: ev.score >= 80 ? 'delight' : 'happy',
      aiLog: madeName ? `自分の「好き」を初めて定義した：${madeName}風。` : '「好き」の定義は未確定。だが市民は笑っている。',
    };
  }

  // 要望（アレルギーは最優先で強く反応）
  const allergy = ev.modResults.find((m) => !m.ok && m.id.startsWith('allergy'));
  if (allergy) {
    lines.push(pick(rng, MODIFIERS[allergy.id].bad));
    lines.push(pick(rng, STAR_LINES[p][1]).replaceAll('{want}', ev.target.base));
    return { lines, mood: 'angry', aiLog: pick(rng, AI_LOG.allergy) };
  }

  // 一番大きな問題にひとこと
  if (top && top.weight >= 8) {
    let line = '';
    switch (top.kind) {
      case 'wrongDish':
      case 'unknown':
        line = pick(rng, ISSUE_LINES[top.kind][voice]);
        break;
      case 'burnt':
        line = pick(rng, ISSUE_LINES.burnt[voice]);
        break;
      case 'heatLow':
      case 'heatHigh':
        line = pick(rng, ISSUE_LINES[heatLineKey(ev)][voice]);
        break;
      case 'form':
        line = pick(rng, ISSUE_LINES.form[voice]);
        break;
      case 'ingMissing':
      case 'ingExtra': {
        const t = top.ing ? ING_TASTE[top.ing][top.kind === 'ingMissing' ? 'missing' : 'extra'] : '';
        line = pick(rng, ING_LINE_WRAP[voice]).replace('{t}', t);
        break;
      }
      case 'toppingMissing':
      case 'toppingExtra':
      case 'toppingWrong':
      case 'vessel':
      case 'slow':
        line = pick(rng, ISSUE_LINES[top.kind][voice]);
        break;
      case 'mod': {
        const m = top.mod ? MODIFIERS[top.mod] : null;
        if (m) line = pick(rng, m.bad);
        break;
      }
      default:
        break;
    }
    if (line) lines.push(fill(line, ev));
  }
  // 要望が満たされていたら一言
  const goodMod = ev.modResults.find((m) => m.ok);
  if (goodMod && ev.stars >= 3 && lines.length === 0) lines.push(pick(rng, MODIFIERS[goodMod.id].good));

  // 星の数に応じた締め
  const story = order.story?.after;
  if (story) {
    const bucket = ev.stars >= 4 ? story.good : ev.stars === 3 ? story.mid : story.bad;
    lines.push(...bucket);
  } else {
    lines.push(fill(pick(rng, STAR_LINES[p][ev.stars]), ev));
  }

  const mood: Mood =
    ev.stars === 5 ? 'delight' : ev.stars === 4 ? 'happy' : ev.stars === 3 ? 'neutral' : ev.stars === 2 ? (top?.kind === 'unknown' || top?.kind === 'wrongDish' ? 'confused' : 'sad') : 'angry';

  let aiLog: string;
  if (ev.stars === 5) aiLog = pick(rng, AI_LOG.perfect);
  else if (!ev.correctDish) aiLog = pick(rng, AI_LOG.wrong);
  else if (top?.kind === 'mod' && top.mod) aiLog = pick(rng, AI_LOG.mod).replace('{mod}', MODIFIERS[top.mod].label);
  else if (ev.stars === 4) aiLog = pick(rng, AI_LOG.good);
  else if (ev.stars === 3) aiLog = pick(rng, AI_LOG.mid);
  else aiLog = pick(rng, AI_LOG.bad);
  return { lines, mood, aiLog: fill(aiLog, ev) };
}
