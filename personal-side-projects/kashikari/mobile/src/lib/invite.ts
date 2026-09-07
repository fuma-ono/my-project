// app.jsonのschemeと同じ値。将来スタンドアロン/開発ビルドにすれば、この
// リンクをタップするだけでkashikariが開くようになる(Expo Go上では
// 独自schemeのリンクを他アプリのJSバンドルへ渡す仕組みがないため開けない。
// 現時点ではあくまで招待コードの「持ち運びやすい形」として使う)。
const SCHEME = 'kashikari';

export function buildInviteUrl(code: string): string {
  return `${SCHEME}://join?code=${encodeURIComponent(code)}`;
}
