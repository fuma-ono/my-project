// デザイントークン。personal-side-projects/kashikari/app/index.html(Web版プロトタイプ)の
// 配色・書体をそのまま踏襲している。両方を直す場合は同じ値をこちらにも反映すること。
//
// 2回目の見直し(2024): 「色がごちゃごちゃ」という指摘を受け、書体をFredoka+
// Work Sansの2系統からManrope1系統に統一。配色もアクセント(コーラル)+
// セカンダリ(スレートティール)の2色に絞り、アバターも8色の原色寄りな
// パレットから、彩度を抑えた4色に削減した。

export const colors = {
  bg: '#fff9f2',
  surface: '#ffffff',
  surface2: '#fff3e8',
  ink: '#2b2420',
  muted: '#948572',
  line: '#f1e4d3',
  // 主アクセント(CTA・お金の記録・「あなた」のハイライト)
  accent: '#ff6b4a',
  accentInk: '#ffffff',
  accentSoft: '#ffe4da',
  // 副アクセント(頼みごとの記録)。彩度を落として主アクセントと喧嘩しないようにする
  favor: '#4f7d8c',
  favorSoft: '#e3edef',
  // フォームのバリデーションエラー表示専用(装飾ではなく意味を持つ色なので、
  // アクセント2色とは別に最小限だけ用意する)
  danger: '#c14a3a',
} as const;

export const fonts = {
  display: 'Manrope_700Bold',
  displayMedium: 'Manrope_600SemiBold',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemiBold: 'Manrope_600SemiBold',
} as const;

// 彩度・明度を揃えた4色のみ(主アクセントの色相違いバリエーション)。
// 誰が誰でも「同じ家族の色」に見えるようにし、原色が乱立する印象を避ける。
export const AVATAR_PALETTE = ['#ff6b4a', '#4f7d8c', '#d99a3d', '#9c6b8c'];

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
