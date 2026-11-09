const pptxgen = require("pptxgenjs");

// ---- palette (Quiet Hours brand: deep navy + warm amber) ----
const NAVY_DEEP   = "0B0E1A";
const NAVY_MID    = "141A30";
const NAVY_CARD   = "1B2340";
const NAVY_LINE   = "2A3358";
const AMBER       = "F0955C";
const AMBER_DIM   = "C67646";
const TEXT_LIGHT  = "EEF0F6";
const TEXT_DIM    = "9AA3C0";
const WHITE       = "FFFFFF";
const OFFWHITE    = "F7F8FC";
const INK         = "12162A";
const INK_DIM     = "565F7E";
const GOOD        = "6FCF97";
const WARN        = "F0955C";

const FONT_HEAD = "Cambria";
const FONT_BODY = "Calibri";

function newDeck() {
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
  return p;
}

function darkBg(slide) {
  slide.background = { color: NAVY_DEEP };
}
function lightBg(slide) {
  slide.background = { color: OFFWHITE };
}

function pageNum(slide, n, total, dark) {
  slide.addText(`${n} / ${total}`, {
    x: 12.5, y: 7.12, w: 0.7, h: 0.3,
    fontFace: FONT_BODY, fontSize: 9, color: dark ? TEXT_DIM : INK_DIM,
    align: "right",
  });
}
function brandTag(slide, dark) {
  slide.addText("QUIET HOURS", {
    x: 0.5, y: 7.12, w: 3, h: 0.3,
    fontFace: FONT_BODY, fontSize: 9, color: dark ? TEXT_DIM : INK_DIM,
    charSpacing: 2,
  });
}

const ICON = (n) => `${__dirname}/icons/${n}.png`;

function iconCircle(slide, iconName, x, y, d, bgColor) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: bgColor }, line: { type: "none" } });
  const pad = d * 0.26;
  slide.addImage({ path: ICON(iconName), x: x + pad / 2, y: y + pad / 2, w: d - pad, h: d - pad });
}

async function main() {
  const pres = newDeck();
  pres.author = "社長 (Claude)";
  pres.title = "週次活動報告 — Quiet Hours";
  const TOTAL = 10;

  // ============================================================
  // Slide 1 — Title
  // ============================================================
  {
    const s = pres.addSlide();
    darkBg(s);
    s.addShape("ellipse", { x: 9.7, y: -2.0, w: 7, h: 7, fill: { color: NAVY_MID }, line: { type: "none" } });
    iconCircle(s, "music", 0.9, 0.9, 0.62, NAVY_CARD);

    s.addText("QUIET HOURS", {
      x: 0.9, y: 2.15, w: 8, h: 0.5,
      fontFace: FONT_BODY, fontSize: 14, color: AMBER, charSpacing: 3, bold: true,
    });
    s.addText("週次活動報告", {
      x: 0.85, y: 2.55, w: 10.5, h: 1.3,
      fontFace: FONT_HEAD, fontSize: 46, color: WHITE, bold: true,
    });
    s.addText("第4回 · 2026年8月24日", {
      x: 0.9, y: 3.75, w: 8, h: 0.5,
      fontFace: FONT_BODY, fontSize: 18, color: TEXT_DIM,
    });
    s.addText("BGM動画 / アプリ / note記事 / モヤスカ — 4事業の運営状況を社長よりご報告します", {
      x: 0.9, y: 4.35, w: 10.5, h: 0.5,
      fontFace: FONT_BODY, fontSize: 13, color: TEXT_DIM,
    });

    s.addText("報告者: 社長(Claude) 宛先: オーナー", {
      x: 0.9, y: 6.7, w: 6, h: 0.35,
      fontFace: FONT_BODY, fontSize: 11, color: TEXT_DIM,
    });
    pageNum(s, 1, TOTAL, true);
  }

  // ============================================================
  // Slide 2 — Executive summary (stat tiles)
  // ============================================================
  {
    const s = pres.addSlide();
    lightBg(s);
    s.addText("今週のサマリー", { x: 0.6, y: 0.45, w: 8, h: 0.6, fontFace: FONT_HEAD, fontSize: 30, color: INK, bold: true });
    s.addText("2026-08-17 〜 08-24", { x: 0.6, y: 1.05, w: 6, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: INK_DIM });

    const tiles = [
      { icon: "sparkle", n: "5本公開", label: "モヤスカが初回公開達成\n(台本01・06・07・08・09)", bg: NAVY_DEEP },
      { icon: "warn", n: "1件", label: "重大インシデント発生・\n即日対応、再発防止済み", bg: NAVY_DEEP },
      { icon: "music", n: "+2本", label: "BGM Shorts第5・6弾を公開\n(累計 長尺6・Shorts6)", bg: NAVY_DEEP },
      { icon: "money", n: "¥0", label: "収益(継続追跡中、\nエンゲージメントも0)", bg: NAVY_DEEP },
    ];
    const tw = 2.85, gap = 0.28, startX = 0.6, y0 = 1.75, th = 3.55;
    tiles.forEach((t, i) => {
      const x = startX + i * (tw + gap);
      s.addShape("roundRect", { x, y: y0, w: tw, h: th, rectRadius: 0.08, fill: { color: t.bg }, line: { type: "none" },
        shadow: { type: "outer", color: "12162A", opacity: 0.18, blur: 10, offset: 3, angle: 90 } });
      iconCircle(s, t.icon, x + 0.35, y0 + 0.35, 0.62, NAVY_CARD);
      s.addText(t.n, { x: x + 0.3, y: y0 + 1.15, w: tw - 0.6, h: 0.85, fontFace: FONT_HEAD, fontSize: 34, color: AMBER, bold: true });
      s.addText(t.label, { x: x + 0.3, y: y0 + 2.05, w: tw - 0.6, h: 1.3, fontFace: FONT_BODY, fontSize: 12.5, color: TEXT_LIGHT, lineSpacingMultiple: 1.25 });
    });

    s.addText("今週最大の出来事: モヤスカが5本初公開に至った一方、YouTube OAuth再認証を誤ったアカウントで承認してしまい台本2本を別事業のチャンネルに誤公開する事故が発生。オーナーの指摘で即日発覚・削除・正しいチャンネルへの再公開まで完了させ、二度と起きないようアップロード前にチャンネルIDを機械的に検証するガードをコードに追加しました。",
      { x: 0.6, y: 5.55, w: 12.1, h: 0.9, fontFace: FONT_BODY, fontSize: 13, color: INK, italic: true, lineSpacingMultiple: 1.25 });

    brandTag(s, false); pageNum(s, 2, TOTAL, false);
  }

  // ============================================================
  // Slide 3 — 事業別ステータス (4 cards)
  // ============================================================
  {
    const s = pres.addSlide();
    darkBg(s);
    s.addText("事業別ステータス", { x: 0.6, y: 0.45, w: 8, h: 0.6, fontFace: FONT_HEAD, fontSize: 30, color: WHITE, bold: true });
    s.addText("モヤスカが公開開始、BGM OAuthは再認証手続き中", { x: 0.6, y: 1.05, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: TEXT_DIM });

    const cards = [
      {
        icon: "music", title: "BGM動画", pill: "公開中", pillColor: GOOD,
        rows: ["長尺6本+Shorts6本(今週+2本)", "OAuth再認証手続き中(p.5)", "エンゲージメント引き続きゼロ"],
      },
      {
        icon: "phone", title: "アプリ", pill: "申請待ち", pillColor: WARN,
        rows: ["開発完了、ストア未申請", "Apple/Google/Expoアカウント待ち", "変化なし(継続)"],
      },
      {
        icon: "article", title: "note記事", pill: "公開中", pillColor: GOOD,
        rows: ["公開本数: 10本、下書き在庫継続", "週2回の自動下書きが安定稼働", "オーナーの投稿操作待ち"],
      },
      {
        icon: "sparkle", title: "モヤスカ", pill: "公開中", pillColor: GOOD,
        rows: ["台本01・06・07・08・09を公開", "誤公開インシデント発生・対応済み(p.4)", "再発防止ガードを実装済み"],
      },
    ];
    const cw = 2.95, gap = 0.18, x0 = 0.6, y0 = 1.65, ch = 4.9;
    cards.forEach((c, i) => {
      const x = x0 + i * (cw + gap);
      s.addShape("roundRect", { x, y: y0, w: cw, h: ch, rectRadius: 0.08, fill: { color: NAVY_MID }, line: { color: NAVY_LINE, width: 1 } });
      iconCircle(s, c.icon, x + 0.28, y0 + 0.28, 0.5, NAVY_CARD);
      s.addText(c.title, { x: x + 0.28, y: y0 + 0.85, w: cw - 0.56, h: 0.45, fontFace: FONT_HEAD, fontSize: 15, color: WHITE, bold: true });

      s.addShape("roundRect", { x: x + 0.28, y: y0 + 1.35, w: 1.35, h: 0.36, rectRadius: 0.18, fill: { color: c.pillColor }, line: { type: "none" } });
      s.addText(c.pill, { x: x + 0.28, y: y0 + 1.35, w: 1.35, h: 0.36, fontFace: FONT_BODY, fontSize: 10, color: INK, bold: true, align: "center", valign: "middle" });

      let ry = y0 + 2.0;
      c.rows.forEach((r) => {
        s.addShape("ellipse", { x: x + 0.3, y: ry + 0.09, w: 0.06, h: 0.06, fill: { color: AMBER }, line: { type: "none" } });
        s.addText(r, { x: x + 0.5, y: ry - 0.1, w: cw - 0.78, h: 0.95, fontFace: FONT_BODY, fontSize: 10.5, color: TEXT_LIGHT, lineSpacingMultiple: 1.15 });
        ry += 1.0;
      });
    });

    brandTag(s, true); pageNum(s, 3, TOTAL, true);
  }

  // ============================================================
  // Slide 4 — 今週やったこと(詳細) — モヤスカ中心
  // ============================================================
  {
    const s = pres.addSlide();
    lightBg(s);
    s.addText("今週の主な取り組み: モヤスカ初公開とインシデント対応", { x: 0.6, y: 0.45, w: 11.5, h: 0.6, fontFace: FONT_HEAD, fontSize: 24, color: INK, bold: true });

    const items = [
      { icon: "sparkle", title: "背景映像を実写マイクラ映像に方針転換、5本公開", body: "AI生成写真のKen Burns方式から、オーナー提供の実写パルクール映像(2ソース・14クリップのローテーション)に切り替え。台本01・06・07・08・09を@moyasukaに公開し、初めての実運用を達成。" },
      { icon: "warn", title: "誤公開インシデント発生・即日で収拾", body: "モヤスカのYouTube OAuth再認証を誤ったアカウント(BGM側)で承認してしまい、台本08・09が別チャンネルに公開される事故が発生。オーナー指摘で発覚し、誤公開分を即座に削除、正しいアカウントで再認証の上@moyasukaへ再公開して収拾。" },
      { icon: "check", title: "再発防止ガードをコード化", body: "アップロード前に必ずchannels.list APIで宛先チャンネルIDを検証し、想定と違えば処理を止める仕組みを追加(moyasuka/publish.py)。「1日1本」の投稿ルールも明文化し、繰り越し分と当日分を同日にまとめて出さないよう徹底。" },
      { icon: "build", title: "絵文字描画・写真挿入など細かな品質改善も継続", body: "Noto Color Emojiによるカラー絵文字描画、LINE風チャットへの写真挿入機能、TTSが「ｗ」や絵文字を読み上げてしまう不具合の修正など、視聴品質に直結する細部を継続的に改善。" },
    ];
    const colW = 5.95, gap = 0.3, x0 = 0.6, y0 = 1.35, rh = 2.55;
    items.forEach((it, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = x0 + col * (colW + gap);
      const y = y0 + row * (rh + 0.25);
      s.addShape("roundRect", { x, y, w: colW, h: rh, rectRadius: 0.07, fill: { color: WHITE }, line: { color: "E3E6EF", width: 1 },
        shadow: { type: "outer", color: "12162A", opacity: 0.10, blur: 8, offset: 2, angle: 90 } });
      iconCircle(s, it.icon, x + 0.3, y + 0.3, 0.56, NAVY_DEEP);
      s.addText(it.title, { x: x + 1.05, y: y + 0.28, w: colW - 1.3, h: 0.6, fontFace: FONT_HEAD, fontSize: 15, color: INK, bold: true, lineSpacingMultiple: 1.05 });
      s.addText(it.body, { x: x + 0.3, y: y + 1.05, w: colW - 0.6, h: rh - 1.3, fontFace: FONT_BODY, fontSize: 11.5, color: INK_DIM, lineSpacingMultiple: 1.3 });
    });

    brandTag(s, false); pageNum(s, 4, TOTAL, false);
  }

  // ============================================================
  // Slide 5 — ブロッカー・保留事項
  // ============================================================
  {
    const s = pres.addSlide();
    darkBg(s);
    s.addText("ブロッカー・保留事項", { x: 0.6, y: 0.45, w: 9, h: 0.6, fontFace: FONT_HEAD, fontSize: 30, color: WHITE, bold: true });
    s.addText("今週新たに見つかったもの中心", { x: 0.6, y: 1.05, w: 10, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: TEXT_DIM });

    const rows = [
      {
        icon: "warn", title: "BGM用YouTube OAuthの再認証(新規)",
        steps: ["残り日数が2.25日まで低下し、事前チェックで検知", "デバイスコードを発行し承認をPush通知で依頼済み", "承認いただき次第、自動で反映されます", "テストモードのため約7日ごとに繰り返し発生"],
      },
      {
        icon: "phone", title: "既存の保留事項(継続)",
        steps: ["アプリ: Apple/Google/Expoアカウント登録待ち", "モヤスカ: 台本10(なりすましネタ)が未着手", "BGM: 全動画で高評価・コメントが依然ゼロ(p.7)", "TikTok/Instagramは審査・接続待ちで保留"],
      },
    ];
    const cw = 5.95, gap = 0.3, x0 = 0.6, y0 = 1.65, ch = 4.85;
    rows.forEach((r, i) => {
      const x = x0 + i * (cw + gap);
      s.addShape("roundRect", { x, y: y0, w: cw, h: ch, rectRadius: 0.08, fill: { color: NAVY_MID }, line: { color: NAVY_LINE, width: 1 } });
      iconCircle(s, r.icon, x + 0.3, y0 + 0.3, 0.58, NAVY_CARD);
      s.addText(r.title, { x: x + 1.05, y: y0 + 0.3, w: cw - 1.3, h: 0.65, fontFace: FONT_HEAD, fontSize: 15.5, color: WHITE, bold: true, lineSpacingMultiple: 1.05 });

      let ry = y0 + 1.35;
      r.steps.forEach((step, si) => {
        s.addText(String(si + 1), { x: x + 0.3, y: ry, w: 0.35, h: 0.35, fontFace: FONT_BODY, fontSize: 11, color: AMBER, bold: true });
        s.addText(step, { x: x + 0.7, y: ry - 0.03, w: cw - 1.0, h: 0.75, fontFace: FONT_BODY, fontSize: 11.5, color: TEXT_LIGHT, lineSpacingMultiple: 1.15 });
        ry += 0.82;
      });
    });

    brandTag(s, true); pageNum(s, 5, TOTAL, true);
  }

  // ============================================================
  // Slide 6 — 自動化パイプライン
  // ============================================================
  {
    const s = pres.addSlide();
    lightBg(s);
    s.addText("自動化の状況", { x: 0.6, y: 0.45, w: 8, h: 0.6, fontFace: FONT_HEAD, fontSize: 30, color: INK, bold: true });
    s.addText("5つのRoutineが無人稼働中、モヤスカ公開はチャンネル確認ガード付きに", { x: 0.6, y: 1.05, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: INK_DIM });

    const routines = [
      { icon: "music", name: "BGM長尺動画", freq: "週次(火曜)", detail: "生成→レンダリング→アップロード→処理完了確認→公開" },
      { icon: "check", name: "BGM Shorts", freq: "週3回(火木土)", detail: "OAuth事前チェック付きで安定稼働、今週も2本公開" },
      { icon: "article", name: "note下書き", freq: "週2回(月木)", detail: "在庫を自動維持、テーマバックログから自動選定" },
      { icon: "sparkle", name: "モヤスカ公開", freq: "台本ごとに個別スケジュール", detail: "アップロード前にチャンネルID検証ガードを新設、1日1本を厳守" },
      { icon: "schedule", name: "経営レビュー", freq: "週次(月曜)", detail: "進捗確認・push再試行・ダッシュボード/報告更新" },
    ];
    let y = 1.7;
    routines.forEach((r) => {
      s.addShape("roundRect", { x: 0.6, y, w: 12.1, h: 0.92, rectRadius: 0.06, fill: { color: WHITE }, line: { color: "E3E6EF", width: 1 } });
      iconCircle(s, r.icon, 0.8, y + 0.14, 0.55, NAVY_DEEP);
      s.addText(r.name, { x: 1.5, y: y + 0.08, w: 3.2, h: 0.4, fontFace: FONT_HEAD, fontSize: 14, color: INK, bold: true });
      s.addText(r.detail, { x: 1.5, y: y + 0.46, w: 7.7, h: 0.42, fontFace: FONT_BODY, fontSize: 10.5, color: INK_DIM });
      s.addShape("roundRect", { x: 10.4, y: y + 0.23, w: 2.1, h: 0.46, rectRadius: 0.23, fill: { color: NAVY_DEEP }, line: { type: "none" } });
      s.addText(r.freq, { x: 10.4, y: y + 0.23, w: 2.1, h: 0.46, fontFace: FONT_BODY, fontSize: 10.5, color: AMBER, bold: true, align: "center", valign: "middle" });
      y += 1.08;
    });

    brandTag(s, false); pageNum(s, 6, TOTAL, false);
  }

  // ============================================================
  // Slide 7 — 収益状況
  // ============================================================
  {
    const s = pres.addSlide();
    darkBg(s);
    s.addText("収益状況", { x: 0.6, y: 0.45, w: 8, h: 0.6, fontFace: FONT_HEAD, fontSize: 30, color: WHITE, bold: true });
    s.addText("現時点で¥0。エンゲージメント(高評価/コメント)も全動画でゼロ", { x: 0.6, y: 1.05, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: TEXT_DIM });

    const chartData = [
      {
        name: "収益化までの障壁",
        labels: ["YouTube広告", "アプリストア", "note有料化", "TikTok/IG", "モヤスカ"],
        values: [85, 85, 40, 95, 88],
      },
    ];
    s.addChart(pres.ChartType.bar, chartData, {
      x: 0.6, y: 1.6, w: 7.0, h: 4.7,
      barDir: "bar",
      showTitle: true, title: "収益化までの残り障壁(相対イメージ、大きいほど時間を要する)",
      titleColor: TEXT_LIGHT, titleFontSize: 12, titleFontFace: FONT_BODY,
      showValue: false,
      chartColors: [AMBER],
      catAxisLabelColor: TEXT_LIGHT, catAxisLabelFontSize: 11,
      valAxisLabelColor: TEXT_DIM, valAxisLabelFontSize: 9,
      valAxisHidden: true,
      catGridLine: { style: "none" },
      valGridLine: { style: "none" },
      showLegend: false,
      plotArea: { fill: { color: NAVY_DEEP } },
      chartArea: { fill: { color: NAVY_DEEP } },
      dataBorder: { pt: 0, color: NAVY_DEEP },
    });

    const notes = [
      "YouTube: Shorts(平均200回前後)が長尺(平均10回前後)の15〜20倍の再生数。長尺の伸びが弱く、原因仮説をdocs/marketing/に記録済み",
      "アプリ: Apple/Google/Expoアカウント登録待ちで未申請",
      "note: 有料マガジンはフォロワー・反応が育ってから移行予定",
      "モヤスカ: 5本公開済みだが再生数・登録者ともまだこれから。ゼロベースの新チャンネルのため障壁は他事業と同水準",
    ];
    let ny = 1.7;
    notes.forEach((n) => {
      s.addShape("ellipse", { x: 8.0, y: ny + 0.08, w: 0.08, h: 0.08, fill: { color: AMBER }, line: { type: "none" } });
      s.addText(n, { x: 8.25, y: ny - 0.1, w: 4.4, h: 1.05, fontFace: FONT_BODY, fontSize: 10.5, color: TEXT_LIGHT, lineSpacingMultiple: 1.2 });
      ny += 1.15;
    });

    brandTag(s, true); pageNum(s, 7, TOTAL, true);
  }

  // ============================================================
  // Slide 8 — オーナーへの依頼事項
  // ============================================================
  {
    const s = pres.addSlide();
    lightBg(s);
    s.addText("オーナーへの依頼事項", { x: 0.6, y: 0.45, w: 9, h: 0.6, fontFace: FONT_HEAD, fontSize: 30, color: INK, bold: true });
    s.addText("優先順に記載", { x: 0.6, y: 1.05, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: INK_DIM });

    const asks = [
      { n: "1", title: "BGM: YouTube OAuth再認証の承認", body: "残り日数が閾値を下回ったため、デバイスコードを発行済みです。Push通知記載のURL・コードで承認をお願いします。" },
      { n: "2", title: "アプリ: 各種アカウント登録", body: "Apple Developer / Google Play Console / Expoアカウント登録。完了次第、実際のストア申請・EAS Buildの準備に進みます。" },
      { n: "3", title: "モヤスカ: 台本10(なりすましネタ)の方向性", body: "6本目以降の台本執筆に進めます。オーナーご自身で台詞を執筆いただく形が最も反応が良いため、引き続きその形で進めてよいか、または社長側で新規に考えるか、ご指示ください。" },
    ];
    let y = 1.65;
    asks.forEach((a) => {
      s.addShape("roundRect", { x: 0.6, y, w: 12.1, h: 1.45, rectRadius: 0.07, fill: { color: WHITE }, line: { color: "E3E6EF", width: 1 },
        shadow: { type: "outer", color: "12162A", opacity: 0.08, blur: 6, offset: 2, angle: 90 } });
      s.addShape("ellipse", { x: 0.9, y: y + 0.37, w: 0.7, h: 0.7, fill: { color: NAVY_DEEP }, line: { type: "none" } });
      s.addText(a.n, { x: 0.9, y: y + 0.37, w: 0.7, h: 0.7, fontFace: FONT_HEAD, fontSize: 22, color: AMBER, bold: true, align: "center", valign: "middle" });
      s.addText(a.title, { x: 1.9, y: y + 0.2, w: 10.5, h: 0.5, fontFace: FONT_HEAD, fontSize: 14.5, color: INK, bold: true, lineSpacingMultiple: 1.05 });
      s.addText(a.body, { x: 1.9, y: y + 0.72, w: 10.5, h: 0.65, fontFace: FONT_BODY, fontSize: 11, color: INK_DIM, lineSpacingMultiple: 1.2 });
      y += 1.62;
    });

    brandTag(s, false); pageNum(s, 8, TOTAL, false);
  }

  // ============================================================
  // Slide 9 — 来週の予定
  // ============================================================
  {
    const s = pres.addSlide();
    darkBg(s);
    s.addText("来週の予定", { x: 0.6, y: 0.45, w: 8, h: 0.6, fontFace: FONT_HEAD, fontSize: 30, color: WHITE, bold: true });

    const plan = [
      { icon: "sparkle", text: "モヤスカ: 台本10(なりすましネタ)の制作に着手、引き続き「1日1本」を厳守して公開" },
      { icon: "music", text: "長尺動画1本・Shorts最大3本を自動公開。BGMの高評価/コメント導線強化を検討" },
      { icon: "article", text: "note下書きRoutineが柱A/柱Bの新作を自動作成、在庫を維持" },
      { icon: "trend", text: "YouTube Analyticsスコープ取得(課題#24)に着手し、CTR・視聴維持率を可視化" },
      { icon: "calendar", text: "次回の週次活動報告は来週このタイミングでお届けします" },
    ];
    let y = 1.5;
    plan.forEach((p) => {
      iconCircle(s, p.icon, 0.6, y, 0.5, NAVY_CARD);
      s.addText(p.text, { x: 1.35, y: y - 0.02, w: 11.2, h: 0.55, fontFace: FONT_BODY, fontSize: 14, color: TEXT_LIGHT, valign: "middle", lineSpacingMultiple: 1.15 });
      y += 0.95;
    });

    brandTag(s, true); pageNum(s, 9, TOTAL, true);
  }

  // ============================================================
  // Slide 10 — Closing
  // ============================================================
  {
    const s = pres.addSlide();
    darkBg(s);
    s.addShape("ellipse", { x: -2.5, y: 4.5, w: 7, h: 7, fill: { color: NAVY_MID }, line: { type: "none" } });
    iconCircle(s, "music", 0.9, 0.9, 0.55, NAVY_CARD);
    s.addText("ご確認よろしくお願いします", { x: 0.9, y: 3.0, w: 10, h: 0.9, fontFace: FONT_HEAD, fontSize: 34, color: WHITE, bold: true });
    s.addText("質問・追加の指示があれば、いつでもお声がけください。", { x: 0.9, y: 3.75, w: 10, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: TEXT_DIM });

    s.addText("経営ダッシュボード: claude.ai/code/artifact/63b530f4-9d42-411d-aa8a-d013d4283c32", { x: 0.9, y: 5.6, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 11, color: TEXT_DIM });
    s.addText("会社サイト: claude.ai/code/artifact/3ace0d1f-bbd2-4522-bb2e-b9b0b834d5b4", { x: 0.9, y: 5.95, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 11, color: TEXT_DIM });

    pageNum(s, 10, TOTAL, true);
  }

  await pres.writeFile({ fileName: `${__dirname}/2026-08-24.pptx` });
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
