/**
 * HQ指示(2026-10-20)「読み込みが異常に長い原因調査」: `/home`・`/calendar`・
 * `/speeches` の実測ログが無く、Renderのコールドスタート(無料プランは
 * 15分アイドルで休止、次のアクセスで30〜60秒)と通常時の処理時間を
 * 区別できなかった。リクエスト本文・認証トークン・ユーザーIDは含めず、
 * ルート名・処理時間・プロセスの起動からの経過秒数(`process.uptime()`、
 * これが短い=プロセス自体が最近起動した=コールドスタート直後の可能性が
 * 高いことの目印になる)だけを出力する。
 *
 * `fn`の例外はcatchせずそのまま再スローするため、既存のエラー処理
 * (Fastifyのデフォルトのエラーシリアライズ等)は一切変えない —
 * `finally`でログを出すだけ。
 */
export async function withTiming<T>(route: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const processUptimeSec = process.uptime();
  try {
    return await fn();
  } finally {
    const durationMs = Date.now() - startedAt;
    console.log(
      `[timing] route=${route} duration_ms=${durationMs} process_uptime_s=${processUptimeSec.toFixed(1)}`,
    );
  }
}
