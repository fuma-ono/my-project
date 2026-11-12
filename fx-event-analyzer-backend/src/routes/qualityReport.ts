import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import type { QualityReader } from '../ingestion/quality/reader.js';
import { buildQualityReportMarkdown, MAX_REPORT_DAYS } from '../ingestion/quality/run.js';

/** Escapes text for safe placement inside an HTML <pre> block. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function page(markdown: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>データ品質レポート</title>
<pre style="white-space:pre-wrap;word-break:break-word;font-family:-apple-system,system-ui,monospace;font-size:14px;line-height:1.5;padding:12px;margin:0;">${escapeHtml(markdown)}</pre>`;
}

/**
 * GET /api/v1/quality-report?token=…&days=…&pairs=… — HQ判断(2026-10-17)
 * 「実機テスト配布の必須条件」の一つ。既存の report:data-quality と同じ
 * READ-ONLY の集計(ingestion/quality/run.ts)をスマホのブラウザで見られる
 * ようにしたもの。iOSアプリの画面・仕様は変えない(別のURL)。
 *
 * INTERNAL_REPORT_TOKEN が未設定なら常に404(既定で無効 = 追加のインフラも
 * 費用もかからない)。設定したときだけ、その値と一致する ?token= が無いと404。
 * 一般公開のつもりはなく、社内(大野さん・HQ)がテスト期間中に確認するための
 * もの — JWT認証付きの /api/v1 コンテキストとは別に、認証不要の文脈に登録する
 * (speaker-photos と同様)。
 */
export function registerQualityReportRoutes(app: FastifyInstance, deps: { reader: QualityReader }): void {
  app.get<{ Querystring: { token?: string; days?: string; pairs?: string } }>(
    '/quality-report',
    async (request, reply) => {
      const expected = app.env.INTERNAL_REPORT_TOKEN;
      if (!expected || request.query.token !== expected) {
        throw ApiError.notFound('Not found.');
      }
      const days = request.query.days === undefined ? 7 : Number(request.query.days);
      if (!Number.isInteger(days) || days < 1 || days > MAX_REPORT_DAYS) {
        throw ApiError.validation(`days must be an integer between 1 and ${MAX_REPORT_DAYS}.`);
      }
      const symbols = request.query.pairs
        ? request.query.pairs
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : null;
      const markdown = await buildQualityReportMarkdown(deps.reader, { days, symbols, now: new Date() });
      return reply.header('Content-Type', 'text/html; charset=utf-8').send(page(markdown));
    },
  );
}
