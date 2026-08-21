// デザイントークン。personal-side-projects/kashikari/app/index.html(Web版プロトタイプ)の
// 配色・書体をそのまま踏襲している。両方を直す場合は同じ値をこちらにも反映すること。

export const colors = {
  bg: '#fff9f2',
  surface: '#ffffff',
  surface2: '#fff3e8',
  ink: '#2b2420',
  muted: '#948572',
  line: '#f1e4d3',
  accent: '#ff6b4a',
  accentInk: '#ffffff',
  accentSoft: '#ffe4da',
  favor: '#8c4fd1',
  favorSoft: '#ece0fb',
  owe: '#ff5470',
  oweSoft: '#ffe1e6',
  owed: '#1fa37a',
  owedSoft: '#d9f3ea',
} as const;

export const fonts = {
  display: 'Fredoka_600SemiBold',
  displayMedium: 'Fredoka_500Medium',
  body: 'WorkSans_400Regular',
  bodyMedium: 'WorkSans_500Medium',
  bodySemiBold: 'WorkSans_600SemiBold',
} as const;

export const AVATAR_PALETTE = [
  '#ff6b4a',
  '#1fa37a',
  '#2d3a8c',
  '#e0a73c',
  '#8c4fd1',
  '#2aa7c4',
  '#4b8b3b',
  '#e0527a',
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function avatarInitial(name: string): string {
  return Array.from(name || '?')[0] || '?';
}
