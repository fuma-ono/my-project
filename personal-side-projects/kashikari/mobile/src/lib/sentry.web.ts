import { Component, isValidElement } from 'react';
import type { ReactNode } from 'react';

// Web(デモモード)ではSentryへのネイティブクラッシュ送信は不要なため、
// initSentry自体は何もしない(ads.web.ts/purchases.web.tsと同じ.web.ts
// パターン)。
export function initSentry() {}

type FallbackProp = ReactNode | ((args: { resetError: () => void }) => ReactNode);

// SentryErrorBoundaryとしての体裁を保ちつつ、Web版でも「真っ白画面」を
// 避けるために簡易的なReactのエラーバウンダリとして実装する(Sentryへの
// 送信はしない。あくまでデモ/プレビュー用途での見た目の担保)。
// fallbackは実機側(@sentry/react-native)と同じく、要素そのものでも
// resetErrorを受け取る関数でもどちらでも渡せるようにしてある。
export class SentryErrorBoundary extends Component<{ children: ReactNode; fallback?: FallbackProp }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  resetError = () => this.setState({ hasError: false });
  render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      if (typeof fallback === 'function') return fallback({ resetError: this.resetError });
      if (isValidElement(fallback)) return fallback;
      return null;
    }
    return this.props.children;
  }
}
