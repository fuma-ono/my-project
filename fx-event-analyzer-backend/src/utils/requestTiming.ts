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

/** The part of Fastify's request logger (`request.log`, pino) that timing needs. */
export interface TimingLogger {
  info(fields: Record<string, unknown>, message: string): void;
}

/**
 * Marks the end of a stage inside `withTiming`: the time since the previous
 * mark (or the start) is recorded under `name` (HQ承認 2026-10-21「/homeの
 * 各段階の所要時間」). Names are fixed labels chosen by the route — never data.
 */
export type StageMark = (name: string) => void;

/**
 * With `log` (the request's own logger, `request.log`) the line is written
 * through Fastify's structured log, so it carries the same `reqId` and
 * `time` as that request's `incoming request` / `request completed` lines
 * (HQ承認 2026-10-21「同一リクエストを識別できるようにする」). The message
 * text stays the old `[timing] route=… duration_ms=… process_uptime_s=…`
 * so existing log searches still match; stage times are added as fields.
 * Without `log` (callers not yet switched) it prints that same line with
 * `console.log`, as before.
 */
export async function withTiming<T>(
  route: string,
  fn: (mark: StageMark) => Promise<T>,
  log?: TimingLogger,
): Promise<T> {
  const startedAt = Date.now();
  const processUptimeSec = process.uptime();
  const stages: Record<string, number> = {};
  let lastMark = startedAt;
  const mark: StageMark = (name) => {
    const now = Date.now();
    stages[name] = now - lastMark;
    lastMark = now;
  };
  try {
    return await fn(mark);
  } finally {
    const durationMs = Date.now() - startedAt;
    const message = `[timing] route=${route} duration_ms=${durationMs} process_uptime_s=${processUptimeSec.toFixed(1)}`;
    if (log) {
      log.info(
        {
          event: 'route_timing',
          route,
          duration_ms: durationMs,
          process_uptime_s: Number(processUptimeSec.toFixed(1)),
          ...(Object.keys(stages).length > 0 ? { stages_ms: stages } : {}),
        },
        message,
      );
    } else {
      console.log(message);
    }
  }
}
