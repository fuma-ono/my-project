/**
 * SCR-020 ヘルプ・お問い合わせ (api-design.md §24.7/§24.8). Rule-based
 * classification and template auto-replies — no LLM. Pure functions only;
 * the route (src/routes/support.ts) does the I/O.
 */

import { CURRENCY_NAMES } from './currencies.js';

export const SUPPORT_KINDS = ['INQUIRY', 'FEEDBACK'] as const;
export const SUPPORT_CATEGORIES = ['ACCOUNT', 'BILLING', 'NOTIFICATION', 'CHART', 'DATA', 'BUG', 'OTHER'] as const;
export const SUPPORT_BODY_MAX_LENGTH = 2000;

export type SupportKind = (typeof SUPPORT_KINDS)[number];
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export type SupportClassification = 'VALID' | 'BUG' | 'NONSENSE' | 'SPAM';
export type SupportStatus = 'REPLIED' | 'IGNORED' | 'ESCALATED';

export interface SupportRequestInput {
  kind: SupportKind;
  category: SupportCategory;
  body: string;
}

/** NFKC folds full-width letters / digits / symbols (「ｂｕｇ」「０９０」「＠」)
 * and half-width katakana into the forms the rules below are written for. */
function normalizeText(text: string): string {
  return text.normalize('NFKC');
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/gi;
/** This many links (screenshot hosts not counted) make a message SPAM. */
const MAX_URLS = 3;
/** Screenshot / file hosts users paste into bug reports. Links to these
 * (and their subdomains) never count toward MAX_URLS. */
const IMAGE_HOSTS = ['imgur.com', 'i.imgur.com', 'drive.google.com', 'photos.app.goo.gl', 'gyazo.com'];

/** Abusive words and typical spam-ad terms. Deliberately small and specific:
 * a false positive silently drops a real user's message (no reply). Latin
 * entries are matched as whole words, Japanese entries as substrings. */
const BANNED_WORDS_LATIN = ['kill yourself', 'viagra', 'casino', 'porn'];
const BANNED_WORDS_JA = ['死ね', '殺すぞ', 'ぶっ殺', 'くたばれ', '出会い系', 'アダルト動画'];
/** 氏ね (slang spelling of 死ね) — but not right after a name or another
 * kanji: 「パウエル氏ねぇ、…」 is "Mr. Powell, …". */
const SHINE_SLANG_PATTERN = /(?<![\p{Script=Han}\p{Script=Katakana}ー])氏ね/u;
/** Profanity alone does not make a message SPAM ("this shit keeps crashing
 * on launch" is a real report) — only with a link or with hardly anything
 * else said (see PROFANITY_MIN_OTHER_CONTENT). */
const PROFANITY_LATIN = ['fuck', 'fucking', 'fucked', 'shit', 'shitty', 'bitch', 'asshole'];

const BANNED_LATIN_PATTERN = new RegExp(`\\b(?:${BANNED_WORDS_LATIN.join('|')})\\b`, 'i');
const PROFANITY_PATTERN = new RegExp(`\\b(?:${PROFANITY_LATIN.join('|')})\\b`, 'i');
const PROFANITY_PATTERN_GLOBAL = new RegExp(PROFANITY_PATTERN.source, 'gi');
/** Letters left once profanity and links are removed (a Japanese letter
 * counts 2). Below this the message is only abuse: "fuck this app". */
const PROFANITY_MIN_OTHER_CONTENT = 15;

const NONSENSE_MIN_LENGTH = 5;
/** Japanese fits a whole request into a few characters (「返金希望」「解約方法」). */
const NONSENSE_MIN_LENGTH_JA = 2;
const REPEATED_CHAR_RATIO = 0.8;
const LETTER_PATTERN = /\p{L}/u;
const LATIN_LETTER_PATTERN = /[a-z]/i;
const JAPANESE_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
// y is treated as a vowel ("rhythm", "crypto"); 6+ so "strengths" (ngths) passes.
const CONSONANT_RUN_PATTERN = /[bcdfghjklmnpqrstvwxz]{6,}/i;
const KEYBOARD_SEQUENCES = [
  'qwert',
  'werty',
  'ertyu',
  'rtyui',
  'tyuio',
  'yuiop',
  'asdf',
  'sdfg',
  'dfgh',
  'fghj',
  'ghjk',
  'hjkl',
  'zxcv',
  'xcvb',
  'cvbn',
  'vbnm',
];
/** ISO 4217 codes seen in FX pair names, so "GBPCHF" / "NZDCHF" are words. */
const CURRENCY_CODES = new Set([
  ...Object.keys(CURRENCY_NAMES),
  'CNY',
  'CNH',
  'HKD',
  'SGD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'HUF',
  'CZK',
  'MXN',
  'ZAR',
  'TRY',
  'KRW',
  'INR',
  'BRL',
  'THB',
  'XAU',
  'XAG',
]);

/** Japanese bug expressions, matched with their polite / past forms
 * (表示されない・表示されません, 固まる・固まります, …). 落ち- is separate
 * (FALL_PATTERN) because prices fall too. */
const BUG_PATTERNS_JA = [
  /クラッシュ/gu,
  /不具合/gu,
  /バグ/gu,
  /エラー/gu,
  /フリーズ/gu,
  /強制終了/gu,
  /固ま(?:る|り|っ)/gu,
  /動(?:か(?:ない|なく|なかっ)|きません)/gu,
  /(?:表示|反映|保存|更新)され(?:ない|なく|なかっ|ません|ず)/gu,
  /(?:起動|ログイン)(?:し|でき)(?:ない|なく|なかっ|ません)/gu,
  /読み込(?:め(?:ない|なく|なかっ|ません)|ま(?:ない|なく|なかっ)|みません)/gu,
  /開(?:か(?:ない|なく|なかっ)|きません|けない|けません)/gu,
];
/** 落ちる / 落ちた / 落ちます / 落ちて / 落ちちゃう (not 落ち着く). */
const FALL_PATTERN = /落ち(?:る|た|ます|まし|て|ちゃ)/gu;
/** A price word just before 落ち- means the market fell (「ドル円が急に落ちた時に…」),
 * unless an app word is there too (「ドル円の画面を開くと落ちる」). */
const PRICE_CONTEXT_PATTERN =
  /円|ドル|ユーロ|ポンド|フラン|相場|レート|価格|値段|株価|金利|指数|為替|[A-Z]{3}\/?[A-Z]{3}/u;
const APP_CONTEXT_PATTERN = /アプリ|画面|起動|タップ|開/u;
const FALL_CONTEXT_LENGTH = 12;
/** 「不具合ではない」「エラーはありません」「バグじゃなく」 — the keyword is denied. */
const DENIED_AFTER_PATTERN = /^[がはも]?(?:では|じゃ)?(?:ない|なく|なかっ|ありません|ございません)/u;
/** 「エラーが出ないように」「表示されないようにしたい」 — something to avoid, not something that happened. */
const AVOIDANCE_PATTERN = /^[^。、,.!?\n]{0,12}?ないように/u;
// Word boundaries on both sides: not "debug", not "Bugatti".
const BUG_KEYWORDS_LATIN_PATTERN = /\b(?:crash(?:es|ed|ing)?|bugs?|buggy|errors?|freez(?:e|es|ing)|froze(?:n)?)\b/i;

function urlHost(url: string): string {
  const withoutScheme = url.replace(/^https?:\/\//i, '');
  const host = withoutScheme.split(/[/?#:]/)[0] ?? '';
  return host.toLowerCase().replace(/^www\./, '');
}

function isImageHostUrl(url: string): boolean {
  const host = urlHost(url);
  return IMAGE_HOSTS.some((imageHost) => host === imageHost || host.endsWith(`.${imageHost}`));
}

function contentScore(text: string): number {
  let score = 0;
  for (const char of text) {
    if (LATIN_LETTER_PATTERN.test(char)) score += 1;
    else if (LETTER_PATTERN.test(char)) score += 2;
  }
  return score;
}

function isSpam(text: string): boolean {
  const urls = text.match(URL_PATTERN) ?? [];
  const withoutUrls = text.replace(URL_PATTERN, ' ');
  // A body that is nothing but link(s) (plus symbols / whitespace).
  if (urls.length > 0 && !LETTER_PATTERN.test(withoutUrls)) return true;
  const otherUrls = urls.filter((url) => !isImageHostUrl(url));
  if (otherUrls.length >= MAX_URLS) return true;
  if (BANNED_LATIN_PATTERN.test(text)) return true;
  if (BANNED_WORDS_JA.some((word) => text.includes(word)) || SHINE_SLANG_PATTERN.test(text)) return true;
  if (PROFANITY_PATTERN.test(text)) {
    if (otherUrls.length > 0) return true;
    return contentScore(withoutUrls.replace(PROFANITY_PATTERN_GLOBAL, ' ')) < PROFANITY_MIN_OTHER_CONTENT;
  }
  return false;
}

/** The most frequent non-whitespace character makes up ≥ 80% of the text ("ああああ", "aaaa!"). */
function isMostlyOneCharacter(text: string): boolean {
  const chars = Array.from(text.replace(/\s/gu, '').toLowerCase());
  if (chars.length === 0) return true;
  const counts = new Map<string, number>();
  for (const char of chars) counts.set(char, (counts.get(char) ?? 0) + 1);
  const max = Math.max(...counts.values());
  return max / chars.length >= REPEATED_CHAR_RATIO;
}

/** "GBPCHF", "USDJPYEURUSD": nothing but currency codes. */
function isCurrencyPairs(token: string): boolean {
  const upper = token.toUpperCase();
  if (upper.length < 6 || upper.length % 3 !== 0) return false;
  for (let index = 0; index < upper.length; index += 3) {
    if (!CURRENCY_CODES.has(upper.slice(index, index + 3))) return false;
  }
  return true;
}

function isMashedToken(token: string): boolean {
  if (isCurrencyPairs(token)) return false;
  const lower = token.toLowerCase();
  return CONSONANT_RUN_PATTERN.test(lower) || KEYBOARD_SEQUENCES.some((sequence) => lower.includes(sequence));
}

/** Keyboard mashing ("asdfghjkl", "jsdkfhwqrtpz"). Only judged when every
 * letter is Latin — a Japanese message with a stray Latin token is not
 * treated as nonsense. Nonsense when mashed tokens make up at least half
 * of the Latin letters. */
function isKeyboardMashing(text: string): boolean {
  const letters = Array.from(text).filter((char) => LETTER_PATTERN.test(char));
  if (letters.length === 0 || !letters.every((char) => LATIN_LETTER_PATTERN.test(char))) return false;
  const tokens = text.match(/[a-z]+/gi) ?? [];
  const mashedLength = tokens.filter(isMashedToken).reduce((sum, token) => sum + token.length, 0);
  return mashedLength * 2 >= letters.length;
}

function isNonsense(text: string): boolean {
  const minLength = JAPANESE_PATTERN.test(text) ? NONSENSE_MIN_LENGTH_JA : NONSENSE_MIN_LENGTH;
  if (Array.from(text).length < minLength) return true;
  if (!LETTER_PATTERN.test(text)) return true;
  if (isMostlyOneCharacter(text)) return true;
  return isKeyboardMashing(text);
}

function isDeniedOrAvoided(text: string, start: number, end: number): boolean {
  return DENIED_AFTER_PATTERN.test(text.slice(end)) || AVOIDANCE_PATTERN.test(text.slice(start));
}

function isPriceFall(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - FALL_CONTEXT_LENGTH), start);
  return PRICE_CONTEXT_PATTERN.test(before) && !APP_CONTEXT_PATTERN.test(before);
}

function hasBugKeyword(text: string): boolean {
  for (const pattern of BUG_PATTERNS_JA) {
    for (const match of text.matchAll(pattern)) {
      if (!isDeniedOrAvoided(text, match.index, match.index + match[0].length)) return true;
    }
  }
  for (const match of text.matchAll(FALL_PATTERN)) {
    const end = match.index + match[0].length;
    if (!isDeniedOrAvoided(text, match.index, end) && !isPriceFall(text, match.index)) return true;
  }
  return BUG_KEYWORDS_LATIN_PATTERN.test(text);
}

function isBugReport(category: SupportCategory, text: string): boolean {
  // The user's own choice of the BUG category always counts.
  if (category === 'BUG') return true;
  return hasBugKeyword(text);
}

/**
 * SPAM → NONSENSE → BUG → VALID, in that order (the first rule that
 * matches wins). INQUIRY and FEEDBACK follow the same rules. The text is
 * NFKC-normalized first.
 */
export function classifySupportRequest(input: SupportRequestInput): SupportClassification {
  const text = normalizeText(input.body).trim();
  if (isSpam(text)) return 'SPAM';
  if (isNonsense(text)) return 'NONSENSE';
  if (isBugReport(input.category, text)) return 'BUG';
  return 'VALID';
}

export function statusForClassification(classification: SupportClassification): SupportStatus {
  switch (classification) {
    case 'VALID':
      return 'REPLIED';
    case 'BUG':
      return 'ESCALATED';
    case 'NONSENSE':
    case 'SPAM':
      return 'IGNORED';
  }
}

const BUG_REPLY =
  '不具合のご報告ありがとうございます。開発チームで確認し、修正対象として登録しました。修正まで今しばらくお待ちいただけますと幸いです。ご不便をおかけし申し訳ございません。';

const FEEDBACK_REPLY =
  'ご意見ありがとうございます。いただいた内容は開発チームで確認し、今後の改善の参考にさせていただきます。引き続きFX Event Analyzerをよろしくお願いいたします。';

const INQUIRY_REPLIES: Record<Exclude<SupportCategory, 'BUG'>, string> = {
  ACCOUNT:
    'お問い合わせありがとうございます。アカウント情報の確認・変更は、設定画面の「アカウント情報」から行えます。アカウントの削除をご希望の場合も、設定画面の「アカウント削除」から行えます。',
  BILLING:
    'お問い合わせありがとうございます。プランのお支払いはApp Storeのサブスクリプションで管理されています。解約や更新の変更は、iPhoneの「設定」アプリ > Apple ID > サブスクリプションから行えます。現在のプランは設定画面の「プラン・購読管理」でご確認いただけます。',
  NOTIFICATION:
    'お問い合わせありがとうございます。通知の対象や時間は、設定画面の「通知設定」から変更できます。通知が届かない場合は、iPhoneの「設定」アプリ > 通知で、本アプリの通知が許可されているかもご確認ください。',
  CHART:
    'お問い合わせありがとうございます。チャートの種類や表示するテクニカル指標は、設定画面の「チャート設定」から変更できます。初期表示の通貨ペアや時間足も同じ画面で設定できます。',
  DATA: 'お問い合わせありがとうございます。各指標の予想値・結果・前回値は、発表元の公表値をもとに表示しています。発表直後は値の反映までお時間をいただく場合があります。',
  OTHER:
    'お問い合わせありがとうございます。内容を確認いたしました。よくある質問もあわせてご覧いただけますと幸いです。今後ともFX Event Analyzerをよろしくお願いいたします。',
};

/** Japanese auto-reply, or null when nothing should be sent (SPAM / NONSENSE). */
export function buildAutoReply(
  classification: SupportClassification,
  kind: SupportKind,
  category: SupportCategory,
): string | null {
  if (classification === 'SPAM' || classification === 'NONSENSE') return null;
  if (classification === 'BUG' || category === 'BUG') return BUG_REPLY;
  if (kind === 'FEEDBACK') return FEEDBACK_REPLY;
  return INQUIRY_REPLIES[category];
}

const REDACTED = '[削除済み]';
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Dash look-alikes NFKC keeps (‐ – — − ー …) between digits → "-". */
const DIGIT_DASH_PATTERN = /(?<=\d)[‐‑‒–—―−ー](?=\d)/gu;
// 090-1234-5678 / 03-1234-5678 / 03 1234 5678 / 03(1234)5678 / (03)1234-5678 / +81-90-1234-5678
const PHONE_PATTERN =
  /(?<!\d)(?:(?:\+81[-\s]?|0)\d{1,4}(?:[-\s]\d{1,4}[-\s]|\(\d{1,4}\))|\(0\d{1,4}\)\s?\d{1,4}[-\s]?)\d{3,4}(?!\d)/g;
// 4111 1111 1111 1111 / 4111-1111-1111-1111 / 3782 822463 10005: groups of
// 3–6 digits joined by single spaces / hyphens, CARD_MIN_DIGITS+ digits in
// total. Dates ("2026-10-06") have 2-digit groups and never match.
const CARD_PATTERN = /(?<!\d)\d{3,6}(?:[ -]\d{3,6}){1,5}(?!\d)/g;
const CARD_MIN_DIGITS = 12;
// Account / member / card numbers written without separators.
const LONG_DIGITS_PATTERN = /\d{7,}/g;

/** Removes personal data a user may have typed (emails, Japanese phone
 * numbers, card numbers, 7+ digit sequences such as account numbers)
 * before the text leaves the Backend for a GitHub Issue. NFKC first, so
 * full-width input (「ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ」「０９０－…」) is caught too. */
export function sanitizeForIssue(text: string): string {
  return normalizeText(text)
    .replace(DIGIT_DASH_PATTERN, '-')
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, REDACTED)
    .replace(CARD_PATTERN, (match) => (match.replace(/\D/g, '').length >= CARD_MIN_DIGITS ? REDACTED : match))
    .replace(LONG_DIGITS_PATTERN, REDACTED);
}

export interface BugIssueSource {
  id: string;
  kind: SupportKind;
  category: SupportCategory;
  body: string;
  app_version: string | null;
  os_version: string | null;
  device_model: string | null;
}

export interface BugIssueContent {
  title: string;
  body: string;
  labels: string[];
}

export const BUG_ISSUE_TITLE_PREFIX = '[アプリ不具合報告] ';
const BUG_ISSUE_TITLE_BODY_LENGTH = 40;
export const BUG_ISSUE_LABELS = ['bug', 'from-app'];

/** One-line table cell: sanitized, whitespace collapsed, pipes escaped. */
function tableCell(value: string | null): string {
  if (value === null || value.trim() === '') return '-';
  return sanitizeForIssue(value).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}

/** A fence longer than any backtick run in the text, so user text cannot close it. */
function fencedBlock(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/**
 * GitHub Issue for a BUG-classified request. Never includes user_id or
 * email — only the request id (to look the row up server-side) and the
 * sanitized text.
 */
export function buildBugIssue(source: BugIssueSource): BugIssueContent {
  const sanitizedBody = sanitizeForIssue(source.body.trim());
  const summary = Array.from(sanitizedBody.replace(/\s+/g, ' ').trim()).slice(0, BUG_ISSUE_TITLE_BODY_LENGTH).join('');

  const body = [
    '## アプリからの不具合報告',
    '',
    '| 項目 | 値 |',
    '|---|---|',
    `| 受付ID | ${source.id} |`,
    `| 種別 | ${source.kind} |`,
    `| カテゴリ | ${source.category} |`,
    `| アプリバージョン | ${tableCell(source.app_version)} |`,
    `| OS | ${tableCell(source.os_version)} |`,
    `| 端末 | ${tableCell(source.device_model)} |`,
    '',
    '## 内容',
    '',
    fencedBlock(sanitizedBody),
    '',
    '---',
    'このIssueはアプリの「ヘルプ・お問い合わせ」から自動作成されました。メールアドレス・電話番号・長い数字列は削除済みです。',
  ].join('\n');

  return { title: `${BUG_ISSUE_TITLE_PREFIX}${summary}`, body, labels: [...BUG_ISSUE_LABELS] };
}
