import { describe, expect, it } from 'vitest';
import {
  BUG_ISSUE_LABELS,
  BUG_ISSUE_TITLE_PREFIX,
  buildAutoReply,
  buildBugIssue,
  classifySupportRequest,
  sanitizeForIssue,
  statusForClassification,
  SUPPORT_CATEGORIES,
  type SupportCategory,
  type SupportKind,
} from '../../src/domain/support.js';

const classify = (body: string, category: SupportCategory = 'OTHER', kind: SupportKind = 'INQUIRY') =>
  classifySupportRequest({ kind, category, body });

describe('classifySupportRequest', () => {
  it('classifies an ordinary question as VALID', () => {
    expect(classify('通知が来るタイミングを変更したいです', 'NOTIFICATION')).toBe('VALID');
    expect(classify('How do I change the chart type?', 'CHART')).toBe('VALID');
    expect(classify('Please add strengths and weaknesses')).toBe('VALID');
    expect(classify('グラフをもっと見やすくしてほしいです', 'OTHER', 'FEEDBACK')).toBe('VALID');
  });

  it('keeps a message with a single link and real text VALID', () => {
    expect(classify('このページの数値が違う気がします https://example.com/page', 'DATA')).toBe('VALID');
  });

  it('does not judge a Japanese message by a stray Latin token', () => {
    expect(classify('設定画面にasdfという文字が出ています')).toBe('VALID');
  });

  describe('BUG', () => {
    it('is BUG whenever the category is BUG', () => {
      expect(classify('グラフの色を変えたいです', 'BUG')).toBe('BUG');
    });

    it.each([
      'チャート画面を開くとアプリが落ちる',
      '昨日から何度も落ちた',
      '起動するとクラッシュします',
      '通知の不具合があります',
      'バグを見つけました',
      'エラーと表示されます',
      'ボタンが動かないです',
      '指標の結果が表示されない',
      '画面が固まることがあります',
      'スクロールするとフリーズします',
      'The app crashes on launch',
      'Found a bug in the search screen',
      'It shows an error when I log in',
    ])('detects a bug keyword: %s', (body) => {
      expect(classify(body)).toBe('BUG');
    });

    it('applies the same rules to FEEDBACK', () => {
      expect(classify('たまにフリーズすることがあります', 'OTHER', 'FEEDBACK')).toBe('BUG');
    });

    it('matches English keywords at a word start only ("debug" is not a bug report)', () => {
      expect(classify('Please add a debug log view')).toBe('VALID');
    });
  });

  describe('SPAM', () => {
    it('is SPAM when the body is only a URL', () => {
      expect(classify('https://example.com/landing')).toBe('SPAM');
      expect(classify('  www.example.com  ')).toBe('SPAM');
      expect(classify('→ https://example.com !!')).toBe('SPAM');
    });

    it('is SPAM with 3 or more URLs', () => {
      expect(classify('おすすめ https://a.example.com https://b.example.com https://c.example.com')).toBe('SPAM');
      expect(classify('参考 https://a.example.com https://b.example.com')).toBe('VALID');
    });

    it.each(['このアプリ死ね', '殺すぞ', 'fuck this app', 'Visit our casino now', '出会い系サイトはこちら'])(
      'is SPAM with a banned word: %s',
      (body) => {
        expect(classify(body)).toBe('SPAM');
      },
    );

    it('matches Latin banned words as whole words only', () => {
      expect(classify('I like shiitake mushrooms')).toBe('VALID');
    });

    it('wins over NONSENSE and BUG', () => {
      expect(classify('https://x.io')).toBe('SPAM');
      expect(classify('バグだ死ね', 'BUG')).toBe('SPAM');
    });
  });

  describe('NONSENSE', () => {
    it('is NONSENSE when shorter than 5 characters after trimming', () => {
      expect(classify('abc')).toBe('NONSENSE');
      expect(classify('   あいう   ')).toBe('NONSENSE');
      expect(classify('バグ', 'BUG')).toBe('NONSENSE');
    });

    it('is NONSENSE without any letter', () => {
      expect(classify('12345678')).toBe('NONSENSE');
      expect(classify('!!!???...')).toBe('NONSENSE');
      expect(classify('😀😀😀😀😀😀')).toBe('NONSENSE');
      expect(classify('123 456 789 000')).toBe('NONSENSE');
    });

    it('is NONSENSE when one character is at least 80% of the text', () => {
      expect(classify('ああああああ')).toBe('NONSENSE');
      expect(classify('aaaaaaaa')).toBe('NONSENSE');
      expect(classify('AAAAaaaa!')).toBe('NONSENSE');
      expect(classify('ああああああああい')).toBe('NONSENSE');
      expect(classify('あああいいい')).toBe('VALID');
    });

    it.each(['asdfghjkl', 'qwertyuiop', 'jsdkfhwqrtpz', 'zxcvbnm asdf'])('detects keyboard mashing: %s', (body) => {
      expect(classify(body)).toBe('NONSENSE');
    });

    it('wins over BUG (even in the BUG category)', () => {
      expect(classify('ああああああ', 'BUG')).toBe('NONSENSE');
      expect(classify('asdfghjkl bug')).toBe('NONSENSE');
    });
  });
});

describe('statusForClassification', () => {
  it('maps VALID → REPLIED, BUG → ESCALATED, NONSENSE/SPAM → IGNORED', () => {
    expect(statusForClassification('VALID')).toBe('REPLIED');
    expect(statusForClassification('BUG')).toBe('ESCALATED');
    expect(statusForClassification('NONSENSE')).toBe('IGNORED');
    expect(statusForClassification('SPAM')).toBe('IGNORED');
  });
});

describe('buildAutoReply', () => {
  const sentenceCount = (text: string) => text.split('。').filter((part) => part.trim() !== '').length;

  it('has a 2–4 sentence Japanese template for every INQUIRY category', () => {
    for (const category of SUPPORT_CATEGORIES) {
      const reply = buildAutoReply('VALID', 'INQUIRY', category);
      expect(reply, category).not.toBeNull();
      expect(sentenceCount(reply!), category).toBeGreaterThanOrEqual(2);
      expect(sentenceCount(reply!), category).toBeLessThanOrEqual(4);
    }
  });

  it('uses a different template per INQUIRY category', () => {
    const inquiryCategories = SUPPORT_CATEGORIES.filter((category) => category !== 'BUG');
    const replies = inquiryCategories.map((category) => buildAutoReply('VALID', 'INQUIRY', category));
    expect(new Set(replies).size).toBe(replies.length);
  });

  it('BILLING points to App Store subscription management for cancellation', () => {
    const reply = buildAutoReply('VALID', 'INQUIRY', 'BILLING')!;
    expect(reply).toContain('App Store');
    expect(reply).toContain('サブスクリプション');
    expect(reply).toContain('解約');
  });

  it('NOTIFICATION points to 通知設定 and the device notification settings', () => {
    const reply = buildAutoReply('VALID', 'INQUIRY', 'NOTIFICATION')!;
    expect(reply).toContain('通知設定');
    expect(reply).toContain('「設定」アプリ');
  });

  it('uses the feedback template for any VALID FEEDBACK', () => {
    const reply = buildAutoReply('VALID', 'FEEDBACK', 'OTHER')!;
    expect(reply).toContain('ご意見ありがとうございます');
    expect(reply).toContain('今後の改善の参考');
    expect(buildAutoReply('VALID', 'FEEDBACK', 'CHART')).toBe(reply);
  });

  it('uses the bug template for BUG, whatever the kind', () => {
    const reply = buildAutoReply('BUG', 'INQUIRY', 'CHART')!;
    expect(reply).toContain('不具合のご報告ありがとうございます');
    expect(reply).toContain('修正対象として登録しました');
    expect(buildAutoReply('BUG', 'FEEDBACK', 'OTHER')).toBe(reply);
    expect(buildAutoReply('BUG', 'INQUIRY', 'BUG')).toBe(reply);
  });

  it('returns null for SPAM and NONSENSE', () => {
    expect(buildAutoReply('SPAM', 'INQUIRY', 'OTHER')).toBeNull();
    expect(buildAutoReply('NONSENSE', 'FEEDBACK', 'OTHER')).toBeNull();
    expect(buildAutoReply('NONSENSE', 'INQUIRY', 'BUG')).toBeNull();
  });
});

describe('sanitizeForIssue', () => {
  it('redacts email addresses', () => {
    expect(sanitizeForIssue('連絡先は taro.yamada+fx@example.co.jp です')).toBe('連絡先は [削除済み] です');
  });

  it.each(['090-1234-5678', '03-1234-5678', '0120 123 456', '03(1234)5678', '+81-90-1234-5678', '+81 3 1234 5678'])(
    'redacts a Japanese phone number: %s',
    (phone) => {
      expect(sanitizeForIssue(`電話: ${phone} まで`)).toBe('電話: [削除済み] まで');
    },
  );

  it('redacts digit sequences of 8 or more', () => {
    expect(sanitizeForIssue('会員番号12345678で')).toBe('会員番号[削除済み]で');
    expect(sanitizeForIssue('09012345678')).toBe('[削除済み]');
  });

  it('keeps dates, times, versions and short numbers', () => {
    const text = '2026-10-06 09:30 にv1.2.3で、1234567回目の起動時';
    expect(sanitizeForIssue(text)).toBe(text);
  });
});

describe('buildBugIssue', () => {
  const source = {
    id: '0d6f3c2e-0000-4000-8000-000000000001',
    kind: 'INQUIRY' as const,
    category: 'BUG' as const,
    body: 'チャート画面を開くと落ちる。\n連絡は taro@example.com か 090-1234-5678 へ。',
    app_version: '1.0.0',
    os_version: 'iOS 18.0',
    device_model: 'iPhone16,1',
  };

  it('titles the Issue with the prefix and the first 40 characters of the sanitized body', () => {
    const issue = buildBugIssue({ ...source, body: `${'あ'.repeat(30)} taro@example.com ${'い'.repeat(30)}` });
    expect(issue.title.startsWith(BUG_ISSUE_TITLE_PREFIX)).toBe(true);
    const summary = issue.title.slice(BUG_ISSUE_TITLE_PREFIX.length);
    expect(Array.from(summary)).toHaveLength(40);
    expect(summary).toBe(`${'あ'.repeat(30)} [削除済み] いい`);
    expect(issue.title).not.toContain('@');
  });

  it('collapses newlines in the title', () => {
    expect(buildBugIssue(source).title).toBe(
      `${BUG_ISSUE_TITLE_PREFIX}チャート画面を開くと落ちる。 連絡は [削除済み] か [削除済み] へ。`,
    );
  });

  it('includes category, kind, device info, request id and the sanitized text', () => {
    const issue = buildBugIssue(source);
    expect(issue.body).toContain(source.id);
    expect(issue.body).toContain('| カテゴリ | BUG |');
    expect(issue.body).toContain('| 種別 | INQUIRY |');
    expect(issue.body).toContain('| アプリバージョン | 1.0.0 |');
    expect(issue.body).toContain('| OS | iOS 18.0 |');
    expect(issue.body).toContain('| 端末 | iPhone16,1 |');
    expect(issue.body).toContain('チャート画面を開くと落ちる。\n連絡は [削除済み] か [削除済み] へ。');
    expect(issue.body).not.toContain('taro@example.com');
    expect(issue.body).not.toContain('090-1234-5678');
    expect(issue.labels).toEqual(BUG_ISSUE_LABELS);
  });

  it('shows missing device info as "-" and escapes table pipes', () => {
    const issue = buildBugIssue({ ...source, app_version: null, os_version: '', device_model: 'a|b' });
    expect(issue.body).toContain('| アプリバージョン | - |');
    expect(issue.body).toContain('| OS | - |');
    expect(issue.body).toContain('| 端末 | a\\|b |');
  });

  it('fences the user text so it cannot break out of the code block', () => {
    const issue = buildBugIssue({ ...source, body: 'before\n```\n# injected\n```\nafter' });
    expect(issue.body).toContain('````text\nbefore\n```\n# injected\n```\nafter\n````');
  });
});
