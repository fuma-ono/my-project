/**
 * 要人発言の本文 → 要約(原文からの抜粋)— HQ指示 2026-11-11「要人発言: 要約生成」。DB にも外部 API にも触れない。
 *
 * 方法(EXTRACTIVE_EN): 本文の文を、本文の中でよく出る語(ありふれた語を除く)をどれだけ含むかで点数を付け、上位の文を
 * **本文の順のまま・そのままの文で**つなぐ。言語モデル・有料 API は使わない。訳さない・言い換えない・足さない。
 * 挨拶・謝辞・免責の決まり文句(「Thank you」「The views expressed … are my own」など)は選ばない。
 * 本文が短すぎる・文が取れないときは要約を作らない(理由を返す)。
 */

export const SUMMARY_METHOD_EXTRACTIVE_EN = 'EXTRACTIVE_EN';
export const SUMMARY_MAX_SENTENCES = 3;
export const SUMMARY_MAX_CHARACTERS = 700;
/** これより短い本文からは要約を作らない(抜き出す意味がない)。 */
export const SUMMARY_MIN_BODY_CHARACTERS = 400;

export type SummaryResult = { ok: true; summary: string } | { ok: false; reason: 'BODY_TOO_SHORT' | 'NO_SENTENCES' };

const STOPWORDS = new Set(
  (
    'a an the and or but if of to in on at by for with from as is are was were be been being this that these those it its ' +
    'we our us i my me you your he she they them their there here which who whom what when where why how not no nor so ' +
    'than too very can could will would should may might must do does did done have has had having also into over under ' +
    'about after before between during through up down out off again further then once all any both each few more most ' +
    'other some such only own same just now one two three new said says like'
  ).split(' '),
);

/** 選ばない決まり文句(挨拶・謝辞・免責・発言の進め方)。 */
const BOILERPLATE = [
  /\bthank(s| you)\b/i,
  /\bviews expressed\b/i,
  /\bmy own (views|opinions)\b/i,
  /\bnot necessarily (those|reflect)\b/i,
  /\b(good (morning|afternoon|evening)|ladies and gentlemen)\b/i,
  /\b(it is|it's) (a|an) (pleasure|honou?r)\b/i,
  /\b(today|this (morning|afternoon)),? i (will|would like to|want to)\b/i,
  /\blet me (begin|start|conclude|turn)\b/i,
  /\bin (closing|conclusion)\b/i,
  /\bquestions?\b.*\b(take|answer|look forward)\b/i,
];

/** 本文 → 文(段落の区切りと、文末の . ! ? の後の空白で分ける。略語の後では分けない)。 */
export function splitSentences(body: string): string[] {
  const out: string[] = [];
  for (const paragraph of body.split(/\n\s*\n/)) {
    const text = paragraph.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const parts = text.split(/(?<=[.!?])\s+(?=["“(]?[A-Z])/);
    let buffer = '';
    for (const part of parts) {
      buffer = buffer ? `${buffer} ${part}` : part;
      // 「U.S.」「Mr.」「e.g.」などの後で切れたものはつなぎ直す
      if (
        /\b(U\.S|U\.K|Mr|Ms|Mrs|Dr|St|No|e\.g|i\.e|etc|vs|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/.test(
          buffer,
        )
      ) {
        continue;
      }
      out.push(buffer.trim());
      buffer = '';
    }
    if (buffer) out.push(buffer.trim());
  }
  return out;
}

const words = (s: string) =>
  (s.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => !STOPWORDS.has(w) && w.length > 2);

export function summarizeExtractive(body: string): SummaryResult {
  if (body.replace(/\s+/g, ' ').trim().length < SUMMARY_MIN_BODY_CHARACTERS)
    return { ok: false, reason: 'BODY_TOO_SHORT' };
  const sentences = splitSentences(body);
  const candidates = sentences
    .map((text, index) => ({ text, index }))
    .filter(
      (s) =>
        s.text.length >= 40 &&
        s.text.length <= 400 &&
        /[.!?]["”’)]?$/.test(s.text) && // 文末記号の無いもの(見出し・箇条の断片)は選ばない
        !BOILERPLATE.some((re) => re.test(s.text)),
    );
  if (candidates.length === 0) return { ok: false, reason: 'NO_SENTENCES' };

  const freq = new Map<string, number>();
  for (const s of sentences) for (const w of words(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const scored = candidates.map((s) => {
    const ws = words(s.text);
    const score = ws.length === 0 ? 0 : ws.reduce((acc, w) => acc + (freq.get(w) ?? 0), 0) / Math.sqrt(ws.length);
    return { ...s, score };
  });
  const picked: typeof scored = [];
  let length = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (picked.length >= SUMMARY_MAX_SENTENCES) break;
    if (length + s.text.length + 1 > SUMMARY_MAX_CHARACTERS) continue;
    picked.push(s);
    length += s.text.length + 1;
  }
  if (picked.length === 0) return { ok: false, reason: 'NO_SENTENCES' };
  const summary = picked
    .sort((a, b) => a.index - b.index)
    .map((s) => s.text)
    .join(' ');
  return { ok: true, summary };
}
