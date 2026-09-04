import * as Sentry from '@sentry/react-native';

// クラッシュ・エラー監視(99回目)。「本番でユーザーがクラッシュに遭遇しても
// 気づく手段が無い」という指摘への対応。
//
// RevenueCat/AdMobと同じ方針で、DSN(.envのEXPO_PUBLIC_SENTRY_DSN)が
// 未設定の間はSentry.init自体を呼ばない(=何も送信されず、アプリの
// 起動やクラッシュ時の挙動にも一切影響しない)。オーナーがSentryの
// アカウントを作ってDSNを控えるまでは、機能が無効なだけでアプリ全体を
// クラッシュさせることはない。
export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    // 開発中(Expo Go/開発ビルド)のノイズを本番と混ぜたくないため分ける。
    environment: __DEV__ ? 'development' : 'production',
    // パフォーマンストレースは今回の目的(クラッシュに気づけるようにする)
    // には不要なため、送信量を抑える意味で低めに設定。
    tracesSampleRate: 0.1,
  });
}

// 画面が真っ白になって何も表示されなくなる(=ユーザーがアプリを閉じて
// 二度と開いてくれない)のを防ぐための、アプリ全体を覆うエラーバウンダリ。
// JSエラーを捕まえてこの簡易画面を出しつつ、Sentryに自動で送信される。
export const SentryErrorBoundary = Sentry.ErrorBoundary;
