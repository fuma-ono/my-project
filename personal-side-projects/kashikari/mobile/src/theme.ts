import { Platform } from 'react-native';

// デザイントークン。personal-side-projects/kashikari/app/index.html(Web版プロトタイプ)の
// 配色・書体をそのまま踏襲している。両方を直す場合は同じ値をこちらにも反映すること。
//
// 4回目の見直し: 「質素すぎる・売れそうに見えない・かっこよくない」という指摘を
// 受け、ブランドの主要な瞬間(ロゴマーク・FAB・主要ボタン・残高ヒーロー)だけ
// コーラル→プラムのグラデーションを使い、視覚的な「決め」を作った。それ以外の
// 面(背景・カード・本文)はニュートラルのまま保ち、装飾を全面に広げて
// ごちゃつかせないようにする(ブランドらしさは1箇所に集中させ、他は静かに)。
//
// 5回目の見直し: 「フォントがまだダメ・もう少しオシャレに」という指摘を受け、
// Manrope1系統から2系統構成に戻した。見出し・大きい数字(ワードマーク、
// 画面タイトル、残高のヒーロー数字)にはSpace Grotesk(数字のデザインが良く、
// モダンなプロダクトでよく使われる個性のある書体)を、本文・ラベルは
// 引き続きManrope(可読性重視)のまま。丸ゴシックのFredokaのような
// 「子供っぽさ」を避けつつ、単一書体だった前回より性格を持たせる狙い。
//
// 6回目の見直し: 「iOS標準のSF Proを使ってほしい」という指示を受け、
// Google FontsのWebフォント読み込みをやめ、OSのシステムフォントに切り替えた。
// SF Proはフォントファイル自体をAppleが配布制限しているため同梱できないが、
// fontFamilyを指定しなければiOSは自動でSan Francisco(SF Pro)、Androidは
// 自動でRobotoを使ってレンダリングする。書体を1系統だけに絞る代わりに、
// 太さ(fontWeight)で見出し/本文の区別をつける、というOS標準アプリと
// 同じ考え方に変更した。
//
// 「フォントがおかしい」という指摘への対応(21回目の見直し): iOS/Android
// のネイティブアプリはfontFamily未指定のままでSF Pro/Robotoに正しく
// 解決されるため変更していない。問題はWeb版(react-native-web)側で、
// fontFamily未指定だとブラウザ標準のフォント(多くの場合Times系)まで
// 落ちてしまい、SF Proにならず「おかしい」見た目になっていた。Web限定で
// -apple-system等を含むCSSフォントスタックを明示することで、Mac/iOSの
// Safari・Chromeで開いたときは正しくSF Proになる(この開発サンドボックス
// はLinuxのため、SF Pro自体が無くスクリーンショットでは代替フォントの
// ままになる。実機のMac/iPhone/iPadで開いたときだけ正しく見える)。
const WEB_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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

// ネイティブ(iOS/Android)はfontFamily未指定のままOS標準フォントに任せ、
// Webだけ明示的にSF Pro(-apple-system)を含むフォントスタックを指定する
// (詳細は上のコメント参照)。太さだけをトークンごとに変える。使う側は
// `style={[..., fonts.display]}` のように展開して使う(fontFamilyと
// fontWeightの2つのスタイルプロパティをまとめて持つオブジェクトのため)。
const webFontFamily = Platform.OS === 'web' ? WEB_FONT_STACK : undefined;

export const fonts = {
  display: { fontFamily: webFontFamily, fontWeight: '700' } as const,
  displayMedium: { fontFamily: webFontFamily, fontWeight: '600' } as const,
  body: { fontFamily: webFontFamily, fontWeight: '400' } as const,
  bodyMedium: { fontFamily: webFontFamily, fontWeight: '500' } as const,
  bodySemiBold: { fontFamily: webFontFamily, fontWeight: '600' } as const,
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

// アバターとして選べる絵文字。動物モチーフで統一し、雰囲気を揃えている。
// カスタム画像のアップロード・ホスティングを持たない構成のため、追加コスト
// なしで「イラストらしいアイコン」を選べるようにする狙い。
export const AVATAR_EMOJI_OPTIONS = [
  '🦊', '🐻', '🐼', '🐨', '🐰', '🐯',
  '🦁', '🐸', '🐵', '🐶', '🐱', '🐹',
  '🦄', '🐺', '🐷', '🐮', '🐔', '🐧',
  '🦉', '🐙', '🐢', '🦋', '🐝', '🐬',
] as const;

// グループのアイコンとして選べる絵文字。個人のアバター(動物モチーフ)と
// 混同されないよう、あえて別のモチーフ(場所・活動)のセットにしている。
// 「大学の友達」「旅行」「職場」のようなグループ名でよくある文脈をカバーする。
export const GROUP_ICON_EMOJI_OPTIONS = [
  '🏠', '🎓', '💼', '✈️', '🍜', '🍻',
  '⚽', '🎮', '🎬', '🎸', '☕', '🎉',
  '🏖️', '🎨', '📚', '💰', '🚗', '🏋️',
  '🎂', '🌸', '⛺', '🎯', '🚲', '🎪',
] as const;
