/**
 * SCR-020 ヘルプ・お問い合わせ (api-design.md §24.7/§24.8). Rule-based
 * classification and template auto-replies — no LLM. Pure functions only;
 * the route (src/routes/support.ts) does the I/O.
 */

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

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/gi;
const MAX_URLS = 3;

/** Abusive words and typical spam-ad terms. Deliberately small and specific:
 * a false positive silently drops a real user's message (no reply). Latin
 * entries are matched as whole words, Japanese entries as substrings. */
const BANNED_WORDS_LATIN = ['fuck', 'fucking', 'shit', 'bitch', 'asshole', 'kill yourself', 'viagra', 'casino', 'porn'];
const BANNED_WORDS_JA = ['死ね', '氏ね', '殺すぞ', 'ぶっ殺', 'くたばれ', '出会い系', 'アダルト動画'];

const BANNED_LATIN_PATTERN = new RegExp(`\\b(?:${BANNED_WORDS_LATIN.join('|')})\\b`, 'i');

const NONSENSE_MIN_LENGTH = 5;
const REPEATED_CHAR_RATIO = 0.8;
const LETTER_PATTERN = /\p{L}/u;
const LATIN_LETTER_PATTERN = /[a-z]/i;
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

const BUG_KEYWORDS_JA = [
  '落ちる',
  '落ちた',
  'クラッシュ',
  '不具合',
  'バグ',
  'エラー',
  '動かない',
  '表示されない',
  '固まる',
  'フリーズ',
];
const BUG_KEYWORDS_LATIN_PATTERN = /\b(?:crash|bug|error)/i;

function countUrls(text: string): number {
  return text.match(URL_PATTERN)?.length ?? 0;
}

function isSpam(text: string): boolean {
  const urlCount = countUrls(text);
  if (urlCount >= MAX_URLS) return true;
  // A body that is nothing but link(s) (plus symbols / whitespace).
  if (urlCount > 0 && !LETTER_PATTERN.test(text.replace(URL_PATTERN, ''))) return true;
  if (BANNED_LATIN_PATTERN.test(text)) return true;
  return BANNED_WORDS_JA.some((word) => text.includes(word));
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

function isMashedToken(token: string): boolean {
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
  if (Array.from(text).length < NONSENSE_MIN_LENGTH) return true;
  if (!LETTER_PATTERN.test(text)) return true;
  if (isMostlyOneCharacter(text)) return true;
  return isKeyboardMashing(text);
}

function isBugReport(category: SupportCategory, text: string): boolean {
  if (category === 'BUG') return true;
  if (BUG_KEYWORDS_LATIN_PATTERN.test(text)) return true;
  return BUG_KEYWORDS_JA.some((keyword) => text.includes(keyword));
}

/**
 * SPAM → NONSENSE → BUG → VALID, in that order (the first rule that
 * matches wins). INQUIRY and FEEDBACK follow the same rules.
 */
export function classifySupportRequest(input: SupportRequestInput): SupportClassification {
  const text = input.body.trim();
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
// 090-1234-5678 / 03-1234-5678 / 03 1234 5678 / 03(1234)5678 / +81-90-1234-5678
const PHONE_PATTERN = /(?<!\d)(?:\+81[-\s]?|0)\d{1,4}(?:[-\s]\d{1,4}[-\s]|\(\d{1,4}\))\d{3,4}(?!\d)/g;
const LONG_DIGITS_PATTERN = /\d{8,}/g;

/** Removes personal data a user may have typed (emails, Japanese phone
 * numbers, long digit sequences such as card / account numbers) before the
 * text leaves the Backend for a GitHub Issue. */
export function sanitizeForIssue(text: string): string {
  return text.replace(EMAIL_PATTERN, REDACTED).replace(PHONE_PATTERN, REDACTED).replace(LONG_DIGITS_PATTERN, REDACTED);
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
