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
const BAD         = "E2725B";

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
    iconCircle(s, "warn", 0.9, 0.9, 0.62, NAVY_CARD);

    s.addText("QUIET HOURS", {
      x: 0.9, y: 2.15, w: 8, h: 0.5,
      fontFace: FONT_BODY, fontSize: 14, color: AMBER, charSpacing: 3, bold: true,
    });
    s.addText("週次活動報告", {
      x: 0.85, y: 2.55, w: 10.5, h: 1.3,
      fontFace: FONT_HEAD, fontSize: 46, color: WHITE, bold: true,
    });
    s.addText("第6回 · 2026年9月7日", {
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
    s.addText("2026-08-31 〜 09-07", { x: 0.6, y: 1.05, w: 6, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: INK_DIM });

    const tiles = [
      { icon: "warn", n: "9日間停止", label: "BGM・モヤスカのYouTube公開が\n8/29を最後に全面停止中", bg: NAVY_DEEP },
      { icon: "sparkle", n: "2段階の障害", label: "①7日ごとのトークン失効\n②環境コンテナ再作成で認証情報が全消失", bg: NAVY_DEEP },
      { icon: "article", n: "6本に復元", label: "note記事の下書き在庫が4本に\n減少→#27・#28を追加し回復", bg: NAVY_DEEP },
      { icon: "check", n: "コード側は無事", label: "gitで管理する全コード・記事は\n無傷。消えたのは認証情報のみ", bg: NAVY_DEEP },
    ];
    const tw = 2.85, gap = 0.28, startX = 0.6, y0 = 1.75, th = 3.55;
    tiles.forEach((t, i) => {
      const x = startX + i * (tw + gap);
      s.addShape("roundRect", { x, y: y0, w: tw, h: th, rectRadius: 0.08, fill: { color: t.bg }, line: { type: "none" },
        shadow: { type: "outer", color: "12162A", opacity: 0.18, blur: 10, offset: 3, angle: 90 } });
      iconCircle(s, t.icon, x + 0.35, y0 + 0.35, 0.62, NAVY_CARD);
      s.addText(t.n, { x: x + 0.3, y: y0 + 1.15, w: tw - 0.6, h: 0.85, fontFace: FONT_HEAD, fontSize: 30, color: AMBER, bold: true });
      s.addText(t.label, { x: x + 0.3, y: y0 + 2.05, w: tw - 0.6, h: 1.3, fontFace: FONT_BODY, fontSize: 12.5, color: TEXT_LIGHT, lineSpacingMultiple: 1.25 });
    });

    s.addText("今週最大の出来事: セッションの作業環境(コンテナ)が丸ごと作り直される事故が発生し、YouTube連携に必要な認証情報一式(client_secret.json含む)が消失しました。単なるトークン失効と違い、OAuthアプリの登録情報そのものが無いため自力での再ログインができず、BGM・モヤスカ両事業の公開が8/29を最後に完全に停止しています。gitで管理しているコード・動画生成の仕組み・note記事などは一切失われておらず、オーナーに client_secret.json の再発行(Google Cloud Console)を依頼して復旧を待っている状態です。この間、YouTube認証が不要なnote記事の下書き作成は影響を受けず稼働を継続しました。",
      { x: 0.6, y: 5.4, w: 12.1, h: 1.05, fontFace: FONT_BODY, fontSize: 12.5, color: INK, italic: true, lineSpacingMultiple: 1.2 });

    brandTag(s, false); pageNum(s, 2, TOTAL, false);
  }

  // ============================================================
  // Slide 3 — 事業別ステータス (4 cards)
  // ============================================================
  {
    const s = pres.addSlide();
    darkBg(s);
    s.addText("事業別ステータス", { x: 0.6, y: 0.45, w: 8, h: 0.6, fontFace: FONT_HEAD, fontSize: 30, color: WHITE, bold: true });
    s.addText("BGM・モヤスカは認証情報復旧待ちで停止、note記事は正常稼働", { x: 0.6, y: 1.05, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: TEXT_DIM });

    const cards = [
      {
        icon: "music", title: "BGM動画", pill: "公開停止", pillColor: BAD,
        rows: ["8/29のShorts公開を最後に停止", "client_secret.json消失が原因", "オーナーの再発行対応待ち"],
      },
      {
        icon: "phone", title: "アプリ", pill: "申請待ち", pillColor: WARN,
        rows: ["開発完了、ストア未申請", "Apple/Google/Expoアカウント待ち", "変化なし(継続)"],
      },
      {
        icon: "article", title: "note記事", pill: "公開中", pillColor: GOOD,
        rows: ["下書き在庫: 4本→6本に復元", "#27「やらないと決めたこと」等", "オーナーの投稿操作待ち"],
      },
      {
        icon: "sparkle", title: "モヤスカ", pill: "公開停止", pillColor: BAD,
        rows: ["BGMと同じclient_secret.json共用", "同じ理由で公開が全面停止中", "台本ストックはあるため復旧後即再開可"],
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
  // Slide 4 — 今週やったこと(詳細) — 障害対応中心
  // ============================================================
  {
    const s = pres.addSlide();
    lightBg(s);
    s.addText("今週の主な取り組み: 障害の診断とnote記事の復旧", { x: 0.6, y: 0.45, w: 11.5, h: 0.6, fontFace: FONT_HEAD, fontSize: 24, color: INK, bold: true });

    const items = [
      { icon: "warn", title: "作業環境の異常を根本原因まで特定", body: "セッションが応答不能になる事態を受け、git状態・remote設定・fetch結果を順に確認。コンテナ自体が空の状態で作り直されていたと判明したが、git履歴は無傷でリモートから完全復旧できることを確認した。" },
      { icon: "sparkle", title: "認証情報消失の被害範囲を特定", body: "gitignore対象だった4事業分のcredentials/フォルダが全て消失していたことを確認。中でもclient_secret.json(OAuthアプリ登録そのもの)の消失は、単なるトークン失効と異なり自力復旧が不可能なため、オーナーへの依頼事項として明確に切り分けた。" },
      { icon: "article", title: "note記事の下書き在庫を4本→6本に復元", body: "YouTube認証が不要な作業は影響を受けないため、通常運用で#27「一人で3つの事業を並行して回すために『やらない』と決めたこと」・#28「¥0事業の“儲かる前提”の罠」を新規生成。#27では今回の実体験そのものを記事の題材として活用した。" },
      { icon: "check", title: "毎日のShorts自動公開Routineは正常に事前検知", body: "OAuth残り日数の事前チェック機構が想定通り動作し、認証情報が無い状態を毎回正しく検知・スキップ。無言で失敗する(2026-08-08に発生した既知のパターン)ことなく、原因を都度確認できている。" },
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
    s.addText("最優先: client_secret.jsonの再発行(オーナー対応が必須)", { x: 0.6, y: 1.05, w: 10.5, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: TEXT_DIM });

    const rows = [
      {
        icon: "warn", title: "最重要・新規: OAuthアプリ登録の消失",
        steps: ["BGM・モヤスカ共用のclient_secret.jsonが消失", "単なるトークン失効と違い自力での再ログイン不可", "Google Cloud Consoleでの再発行が唯一の解決策", "ログイン情報を扱うためオーナー本人の作業が必須"],
      },
      {
        icon: "phone", title: "既存の保留事項(継続)",
        steps: ["アプリ: Apple/Google/Expoアカウント登録待ち", "モヤスカ: 台本10以降の方向性、オーナー確認待ち", "piano_hisaishi_styleの実績判定は復旧後に持ち越し", "TikTok/Instagramは審査・接続待ちで保留"],
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
    s.addText("仕組み自体は健在。BGM・モヤスカは認証情報復旧を待って再稼働", { x: 0.6, y: 1.05, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: INK_DIM });

    const routines = [
      { icon: "warn", name: "BGM長尺動画", freq: "週次(火曜)", detail: "cron自体は正常発火、認証情報復旧待ちで実行を都度スキップ中" },
      { icon: "warn", name: "BGM Shorts", freq: "毎日", detail: "毎日の事前OAuthチェックが正しく検知・スキップ、無言失敗なし" },
      { icon: "article", name: "note下書き", freq: "週2回(月木)", detail: "影響なく正常稼働、在庫4→6本に復元済み" },
      { icon: "warn", name: "モヤスカ台本公開", freq: "個別スケジュール", detail: "同じ認証情報を共用のため同様に停止中" },
      { icon: "schedule", name: "経営レビュー", freq: "週次(月曜)", detail: "BGMコンテンツ戦略の判断は今回のみ、公開停止中のため見送り" },
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
    s.addText("現時点で¥0。BGM・モヤスカは公開停止中のため新規実績なし", { x: 0.6, y: 1.05, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 13, color: TEXT_DIM });

    const chartData = [
      {
        name: "収益化までの障壁",
        labels: ["YouTube広告", "アプリストア", "note有料化", "TikTok/IG", "モヤスカ"],
        values: [90, 85, 40, 95, 90],
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
      "YouTube(BGM): 8/29以降新規公開なし。累計は長尺8本・Shorts11本のまま据え置き",
      "アプリ: Apple/Google/Expoアカウント登録待ちで未申請、変化なし",
      "note: 公開20本・下書き在庫6本に復元。有料マガジンはフォロワー・反応が育ってから移行予定",
      "モヤスカ: 台本ストックはあるが同じ理由で公開停止中、新規実績なし",
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
      { n: "1", title: "最優先: client_secret.jsonの再発行", body: "Google Cloud Console → APIs & Services → Credentials で「TVs and Limited Input devices」種別のOAuthクライアントをダウンロード(無ければ再作成)し、このJSONファイルをお送りください。届き次第、BGM・モヤスカ両方の再ログインを即座に実施します。" },
      { n: "2", title: "アプリ: 各種アカウント登録", body: "Apple Developer / Google Play Console / Expoアカウント登録。完了次第、実際のストア申請・EAS Buildの準備に進みます。" },
      { n: "3", title: "モヤスカ: 台本10以降の方向性", body: "認証情報復旧後すぐに公開を再開できるよう、1日1本ペースで進めてよいか改めてご確認をお願いします。" },
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
      { icon: "warn", text: "client_secret.jsonが届き次第、BGM・モヤスカ両方の再ログインを即日実施し公開を再開" },
      { icon: "music", text: "復旧後、piano_hisaishi_styleの累積実績を確認し新バリエーション・3時間版の要否を判断" },
      { icon: "article", text: "note下書きRoutineが柱A/柱Bの新作を自動作成、在庫を維持" },
      { icon: "sparkle", text: "モヤスカ: 認証復旧・オーナー確認が得られ次第、台本10以降の公開を再開" },
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
    iconCircle(s, "warn", 0.9, 0.9, 0.55, NAVY_CARD);
    s.addText("client_secret.jsonの再発行をお願いします", { x: 0.9, y: 3.0, w: 11, h: 0.9, fontFace: FONT_HEAD, fontSize: 30, color: WHITE, bold: true });
    s.addText("届き次第、その日のうちにBGM・モヤスカの公開を再開します。", { x: 0.9, y: 3.75, w: 10, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: TEXT_DIM });

    s.addText("経営ダッシュボード: claude.ai/code/artifact/63b530f4-9d42-411d-aa8a-d013d4283c32", { x: 0.9, y: 5.6, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 11, color: TEXT_DIM });
    s.addText("会社サイト: claude.ai/code/artifact/3ace0d1f-bbd2-4522-bb2e-b9b0b834d5b4", { x: 0.9, y: 5.95, w: 11, h: 0.35, fontFace: FONT_BODY, fontSize: 11, color: TEXT_DIM });

    pageNum(s, 10, TOTAL, true);
  }

  await pres.writeFile({ fileName: `${__dirname}/2026-09-07.pptx` });
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
