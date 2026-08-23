// デザイントークン。personal-side-projects/kashikari/app/index.html(Web版プロトタイプ)の
// 配色・書体をそのまま踏襲している。両方を直す場合は同じ値をこちらにも反映すること。
//
// 4回目の見直し: 「質素すぎる・売れそうに見えない・かっこよくない」という指摘を
// 受け、ブランドの主要な瞬間(ロゴマーク・FAB・主要ボタン・残高ヒーロー)だけ
// コーラル→プラムのグラデーションを使い、視覚的な「決め」を作った。それ以外の
// 面(背景・カード・本文)はニュートラルのまま保ち、装飾を全面に広げて
// ごちゃつかせないようにする(ブランドらしさは1箇所に集中させ、他は静かに)。

export const colors = {
  bg: '#fff9f2',
  surface: '#ffffff',
  surface2: '#fff3e8',
  ink: '#2b2420',
  muted: '#948572',
  line: '#f1e4d3',
  // 主アクセント(ブランド・CTA)。plumとペアでグラデーションに使う
  accent: '#ff6b4a',
  accentInk: '#ffffff',
  accentSoft: '#ffe4da',
  plum: '#6b3a78',
  // 副アクセント(「頼みごと」の記録種別。装飾用、グラデーションには使わない)
  favor: '#4f7d8c',
  favorSoft: '#e3edef',
  // 意味を持つ色(装飾ではなく金額の向きを伝える): 緑=受け取る、赤=払う
  positive: '#2f8f5b',
  positiveSoft: '#e1f2e8',
  negative: '#c1503f',
  negativeSoft: '#f7e4e0',
  // フォームのバリデーションエラー表示は negative を流用する
  danger: '#c1503f',
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
