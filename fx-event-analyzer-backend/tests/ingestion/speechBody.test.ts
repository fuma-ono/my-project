/**
 * HQ指示(2026-11-10「要人発言本文の取得・保存機能」): 公式ページの URL の判定、本文の取り出し(ナビゲーション・脚注・
 * 図の注記を入れない)、FRB の講演ページとの結び付け(1件に決まるときだけ)。HTML は公式ページの作り(11/10 に確認)を
 * 小さく写したもの。
 */
import { describe, expect, it } from 'vitest';
import {
  extractEcbSpeechBody,
  extractFrbSpeechBody,
  frbSpeechRssItems,
  frbSurnameKey,
  isOfficialSpeechUrl,
  matchFrbSpeechUrls,
} from '../../src/ingestion/speechBody.js';

const FRB_PAGE = `<html><body><nav><p>Skip to main content</p></nav>
<div id="article">
  <div class="heading col-xs-12 col-sm-8 col-md-8">
    <p class='article__time'>October 08, 2026</p>
    <h3 class='title'><em>The Signaling Value</em></h3>
    <p class="speaker"><a href="/x">Governor Christopher J. Waller</a></p>
    <p class='location'>At the Istanbul Economic Forum</p>
  </div>
  <div class="col-xs-12 col-sm-4 col-md-4 hidden-sm"><p>Share</p></div>
  <div class="col-xs-12 col-sm-8 col-md-8">
    <p>Thank you to the Central Bank of T&uuml;rkiye for the opportunity.<a href="#fn1"><sup>1</sup></a> I look forward today.</p>
    <p>As you know, in September the Federal Open Market Committee&nbsp;raised rates.</p>
    <hr align="left" size="1" width="33%" />
    <p><a name="fn1"></a>1. The views expressed here are my own. <a href="#f1">Return to text</a></p>
  </div>
  <div class="col-xs-12 col-sm-4 col-md-4"><p>Related</p></div>
</div>
<div id="lastUpdate">Last Update: October 08, 2026</div><footer><p>Footer text</p></footer></body></html>`;

const ECB_PAGE = `<html><body><header><p>Menu</p></header>
<main >
<div class="title"><ul><li>SPEECH</li></ul><h1>AI adoption in Europe</h1></div>
<div class="section"><h2 class="ecb-pressContentSubtitle">Keynote speech by Philip R. Lane</h2>
<p class="ecb-publicationDate">San Francisco, 30 October 2026</p>
<p>My aim today is to describe how AI is reshaping the euro area economy.<sup>[<a href="#footnote.1">1</a>]</sup> Although…</p>
<div class="figure"><p class="title">Chart 1</p><p class="description">Digital proxy</p><p class="">Sources: Eurostat, ECB and ECB calculations.</p></div>
<p>Looking ahead, tracking the implications of AI will remain high on the agenda.</p>
<div class="footnotes"><p>1. I thank colleagues.</p></div>
</div>
<div class="address-box"><p>European Central Bank, Frankfurt</p></div>
</main><footer><p>Copyright</p></footer></body></html>`;

describe('isOfficialSpeechUrl', () => {
  it('accepts only the https speech pages of each source', () => {
    expect(
      isOfficialSpeechUrl('frb_calendar', 'https://www.federalreserve.gov/newsevents/speech/waller20261008a.htm'),
    ).toBe(true);
    expect(
      isOfficialSpeechUrl(
        'ecb_press_rss',
        'https://www.ecb.europa.eu/press/key/date/2026/html/ecb.sp261030~08d9d540f0.en.html',
      ),
    ).toBe(true);
    for (const [provider, url] of [
      ['frb_calendar', 'http://www.federalreserve.gov/newsevents/speech/waller20261008a.htm'], // http
      ['frb_calendar', 'https://www.federalreserve.gov/newsevents/calendar.htm'], // 講演ページではない
      ['frb_calendar', 'https://example.com/newsevents/speech/waller20261008a.htm'],
      ['ecb_press_rss', 'https://www.ecb.europa.eu/press/inter/date/2026/html/ecb.in261030.en.html'], // インタビュー
      ['ecb_press_rss', 'https://www.federalreserve.gov/newsevents/speech/waller20261008a.htm'], // 取得元が違う
      ['unknown', 'https://www.ecb.europa.eu/press/key/x.en.html'],
      ['frb_calendar', null],
    ] as const) {
      expect(isOfficialSpeechUrl(provider, url), `${provider} ${String(url)}`).toBe(false);
    }
  });
});

describe('extractFrbSpeechBody', () => {
  it('takes the paragraphs of the body column only: no heading, share box, footnotes, related, footer', () => {
    expect(extractFrbSpeechBody(FRB_PAGE)).toBe(
      'Thank you to the Central Bank of Türkiye for the opportunity. I look forward today.\n\nAs you know, in September the Federal Open Market Committee raised rates.',
    );
  });

  it('returns null when the page does not have the expected structure (never a guessed body)', () => {
    expect(extractFrbSpeechBody('<html><body><p>Page not found</p></body></html>')).toBeNull();
    expect(
      extractFrbSpeechBody('<div id="article"><div class="heading col-xs-12 col-sm-8 col-md-8"><p>x</p></div></div>'),
    ).toBeNull();
  });
});

describe('extractEcbSpeechBody', () => {
  it('takes the plain paragraphs of the section only: no date line, chart notes, footnotes, address, header/footer', () => {
    expect(extractEcbSpeechBody(ECB_PAGE)).toBe(
      'My aim today is to describe how AI is reshaping the euro area economy. Although…\n\nLooking ahead, tracking the implications of AI will remain high on the agenda.',
    );
  });

  it('returns null without a <main> section', () => {
    expect(extractEcbSpeechBody('<html><body><p>Error</p></body></html>')).toBeNull();
    expect(extractEcbSpeechBody('<main><div class="section"><p class="x">only classed</p></div></main>')).toBeNull();
  });
});

describe('FRB speech page matching', () => {
  const items = frbSpeechRssItems([
    'https://www.federalreserve.gov/newsevents/speech/bowman20261014a.htm',
    'https://www.federalreserve.gov/newsevents/speech/waller20261008a.htm',
    'https://www.federalreserve.gov/newsevents/speech/cook20261009a.htm',
    'https://www.federalreserve.gov/newsevents/speech/cook20261009b.htm', // 同じ日に2本
    'https://www.federalreserve.gov/newsevents/testimony/powell20261001a.htm', // 講演ではない
    null,
  ]);

  it('reads the surname and the New York date from the speech URL', () => {
    expect(items.map((i) => `${i.surname}|${i.date}`)).toEqual([
      'bowman|2026-10-14',
      'waller|2026-10-08',
      'cook|2026-10-09',
      'cook|2026-10-09',
    ]);
    expect(frbSurnameKey('Christopher J. Waller')).toBe('waller');
    expect(frbSurnameKey('Michelle W. Bowman')).toBe('bowman');
    expect(frbSurnameKey('Lisa D. Cook')).toBe('cook');
  });

  it('links a row only when exactly one item and exactly one row share the surname and date', () => {
    const matched = matchFrbSpeechUrls(
      [
        { id: 'r-bowman', speakerNameEn: 'Michelle W. Bowman', date: '2026-10-14' },
        { id: 'r-waller', speakerNameEn: 'Christopher J. Waller', date: '2026-10-08' },
        { id: 'r-cook', speakerNameEn: 'Lisa D. Cook', date: '2026-10-09' }, // 項目が2件 → 結ばない
        { id: 'r-waller-other-day', speakerNameEn: 'Christopher J. Waller', date: '2026-10-09' }, // 項目なし
        { id: 'r-unknown', speakerNameEn: null, date: '2026-10-14' },
      ],
      items,
    );
    expect(Object.fromEntries(matched)).toEqual({
      'r-bowman': 'https://www.federalreserve.gov/newsevents/speech/bowman20261014a.htm',
      'r-waller': 'https://www.federalreserve.gov/newsevents/speech/waller20261008a.htm',
    });
  });

  it('does not link when two rows share the surname and date (never a guess)', () => {
    const matched = matchFrbSpeechUrls(
      [
        { id: 'a', speakerNameEn: 'Christopher J. Waller', date: '2026-10-08' },
        { id: 'b', speakerNameEn: 'Christopher Waller', date: '2026-10-08' },
      ],
      items,
    );
    expect(matched.size).toBe(0);
  });
});
