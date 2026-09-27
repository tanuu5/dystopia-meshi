import type { FormId, VesselId } from '../data/types.ts';

// 成形・器のアイコン（SVG 文字列）
const S = (inner: string, vb = '0 0 40 32') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const FORM_ICON: Record<FormId, string> = {
  liquid: S('<path d="M4 18c4-4 8 4 12 0s8-4 12 0 6 2 8 0"/><path d="M6 25c4-3 8 3 12 0s8-3 12 0"/>'),
  fizz: S('<circle cx="12" cy="22" r="3"/><circle cx="22" cy="14" r="4"/><circle cx="29" cy="24" r="2.5"/><circle cx="16" cy="8" r="2"/><circle cx="30" cy="8" r="1.5"/>'),
  grain: S(
    '<g fill="currentColor" stroke="none"><ellipse cx="10" cy="22" rx="3" ry="2"/><ellipse cx="17" cy="19" rx="3" ry="2"/><ellipse cx="24" cy="22" rx="3" ry="2"/><ellipse cx="31" cy="20" rx="3" ry="2"/><ellipse cx="14" cy="13" rx="3" ry="2"/><ellipse cx="21" cy="11" rx="3" ry="2"/><ellipse cx="28" cy="14" rx="3" ry="2"/></g>',
  ),
  noodle: S('<path d="M4 10c6 0 6 6 12 6s6-6 12-6 6 6 8 6"/><path d="M4 17c6 0 6 6 12 6s6-6 12-6 6 6 8 6"/><path d="M4 24c6 0 6 5 12 5s6-5 12-5"/>'),
  disc: S('<ellipse cx="20" cy="15" rx="15" ry="6"/><path d="M5 15v4c0 3.3 6.7 6 15 6s15-2.7 15-6v-4"/>'),
  ball: S('<circle cx="12" cy="20" r="6"/><circle cx="28" cy="20" r="6"/><circle cx="20" cy="10" r="6"/>'),
  cube: S('<path d="M8 11l12-6 12 6-12 6z"/><path d="M8 11v12l12 6V17"/><path d="M32 11v12l-12 6"/>'),
  stick: S('<rect x="4" y="9" width="32" height="7" rx="3.5"/><rect x="4" y="19" width="32" height="7" rx="3.5"/>'),
  wedge: S('<path d="M20 4L34 27H6z"/>'),
  dome: S('<path d="M6 26c0-12 6-19 14-19s14 7 14 19z"/><path d="M4 26h32"/>'),
};

export const VESSEL_ICON: Record<VesselId, string> = {
  plate: S('<ellipse cx="20" cy="18" rx="17" ry="6"/><ellipse cx="20" cy="17" rx="10" ry="3"/>'),
  deep: S('<path d="M4 13h32c-1 8-7 12-16 12S5 21 4 13z"/><ellipse cx="20" cy="13" rx="16" ry="3"/>'),
  chawan: S('<path d="M9 10h22c0 8-4 13-11 13S9 18 9 10z"/><path d="M16 23h8v3h-8z"/>'),
  bowl: S('<path d="M3 9h34c0 10-7 17-17 17S3 19 3 9z"/><path d="M15 26h10v3H15z"/>'),
  cup: S('<path d="M8 7h20v15a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z"/><path d="M28 11h3a4 4 0 0 1 0 8h-3"/>'),
  glass: S('<path d="M11 3h18l-3 26H14z"/><path d="M12 10h16"/>'),
};

export const ICON = {
  cool: '❄',
  hot: '🔥',
  pause: S('<rect x="12" y="7" width="5" height="18" rx="1"/><rect x="23" y="7" width="5" height="18" rx="1"/>'),
  book: S('<path d="M6 6h11a3 3 0 0 1 3 3v17a3 3 0 0 0-3-3H6z"/><path d="M34 6H23a3 3 0 0 0-3 3v17a3 3 0 0 1 3-3h11z"/>'),
  trash: S('<path d="M8 9h24"/><path d="M15 9V6h10v3"/><path d="M11 9l2 18h14l2-18"/>'),
  sound: S('<path d="M6 13h6l8-6v18l-8-6H6z"/><path d="M26 11c2 2 2 8 0 10"/><path d="M30 8c4 4 4 12 0 16"/>'),
  mute: S('<path d="M6 13h6l8-6v18l-8-6H6z"/><path d="M26 12l8 8M34 12l-8 8"/>'),
};
