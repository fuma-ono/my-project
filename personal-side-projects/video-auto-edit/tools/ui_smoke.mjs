// UI の実際の操作テスト(AC-U1〜U5, AC-S6)。モデルを使わない偽の文字起こしでサーバーを起動し、
// 見出しのない Chromium で「選ぶ → 解析 → 字幕修正 → 書き出し → 完成」まで操作する。
// 料金・利用制限仕様 v1: マイページ・長さの事前案内・アップグレード画面・AI 再編集・前の版・no_change・キャンセルも確かめる。
//
//   node tools/ui_smoke.mjs <スクリーンショットの保存先フォルダ>
//   環境変数 VAE_PYTHON: 使う Python(既定 python3)
//
// 失敗したら終了コード 1。
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PY = process.env.VAE_PYTHON || "python3";
const outDir = process.argv[2];
if (!outDir) { console.error("使い方: node tools/ui_smoke.mjs <スクリーンショットの保存先>"); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const log = (...a) => console.log("[ui_smoke]", ...a);
const shots = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}

async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch (e) { /* 起動待ち */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("サーバーが起動しませんでした: " + url);
}

async function shot(page, name, opts = {}) {
  const p = path.join(outDir, name);
  await page.screenshot({ path: p, fullPage: true, ...opts });
  shots.push(p);
  log("screenshot", p);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vae_ui_smoke_"));
  const data = path.join(tmp, "data");
  const video = path.join(tmp, "smoke_talk.mp4");
  const bad = path.join(tmp, "notes.txt");
  fs.writeFileSync(bad, "not a video");
  execFileSync(PY, ["-c",
    "import sys; from vae import testing; testing.make_video(sys.argv[1], " +
    "[(0.5,False),(1.2,True),(0.8,False),(1.0,True),(0.7,False),(1.3,True),(0.5,False)])", video],
    { cwd: ROOT, stdio: "inherit" });
  log("synthetic video", video, fs.statSync(video).size, "bytes");
  // FREE の上限(30秒)を1秒超える動画。ブラウザで長さを読めるよう WebM(VP8 + Opus)にする
  const long = path.join(tmp, "long_31s.webm");
  execFileSync(PY, ["-c",
    "import sys; from vae import testing; testing.make_video(sys.argv[1], [(0.5,False),(30.5,True)], size=(320,180), " +
    "codec='libvpx', acodec='libopus', ext_args=('-deadline','realtime','-cpu-used','8','-b:v','100k'))", long],
    { cwd: ROOT, stdio: "inherit" });
  log("synthetic long video", long, fs.statSync(long).size, "bytes");
  // 複数動画(STANDARD)用: 2本目の短い動画と、31秒と合わせて STANDARD の上限(180秒)を1秒超える150秒の動画
  const video2 = path.join(tmp, "smoke_talk2.mp4");
  execFileSync(PY, ["-c",
    "import sys; from vae import testing; testing.make_video(sys.argv[1], " +
    "[(0.4,False),(1.0,True),(0.6,False),(1.1,True),(0.4,False)], tone_hz=300)", video2],
    { cwd: ROOT, stdio: "inherit" });
  const long150 = path.join(tmp, "long_150s.webm");
  execFileSync(PY, ["-c",
    "import sys; from vae import testing; testing.make_video(sys.argv[1], [(0.5,False),(149.5,True)], size=(320,180), " +
    "codec='libvpx', acodec='libopus', ext_args=('-deadline','realtime','-cpu-used','8','-b:v','50k'))", long150],
    { cwd: ROOT, stdio: "inherit" });

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const srvLog = fs.openSync(path.join(outDir, "server.log"), "w");
  const srv = spawn(PY, ["-m", "vae", "web", "--host", "127.0.0.1", "--port", String(port), "--data", data],
    { cwd: ROOT, env: { ...process.env, VAE_FAKE_TRANSCRIBER: "1", VAE_DEV_BILLING: "1" }, stdio: ["ignore", srvLog, srvLog] });
  let browser;
  const pageErrors = [];
  try {
    await waitHttp(base + "/api/plans", 20000);
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ja-JP" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") log("console error:", m.text()); });

    // ① 動画を選ぶ
    await page.goto(base + "/");
    await page.getByText("30秒まで無料").waitFor();
    // マイページ(FREE・今月の残り)
    await page.locator("#acct-sum").filter({ hasText: "残り 3 / 3" }).waitFor({ timeout: 10000 });
    const sum = await page.locator("#acct-sum").textContent();
    if (!sum.includes("FREE")) throw new Error("ヘッダーにプランが出ていません: " + sum);
    await page.getByRole("button", { name: "マイページ" }).click();
    await page.locator("#mypage").waitFor({ state: "visible" });
    const myPlan = await page.locator("#my-plan").textContent();
    const myNew = await page.locator("#my-new").textContent();
    const myExp = await page.locator("#my-expires").textContent();
    if (!myPlan.includes("FREE") || !myNew.includes("残り 3 本") || !myExp.includes("契約はありません"))
      throw new Error(`マイページの表示が違います: ${myPlan} / ${myNew} / ${myExp}`);
    log("mypage:", myPlan, "|", myNew, "|", myExp);
    await shot(page, "00_mypage.png");
    await page.locator("#mypage-close").click();
    if (await page.locator("#mypage").isVisible()) throw new Error("マイページが閉じません");
    // 編集コンセプト: FREE では「上位プラン」の表示
    const locked = await page.locator("#concept-new .lock").count();
    if (locked < 1) throw new Error("FREE で使えないコンセプトに印がありません");
    await shot(page, "01_select.png");
    const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "ja-JP", isMobile: true });
    const mp = await mobile.newPage();
    await mp.goto(base + "/");
    await mp.locator("#acct-sum").filter({ hasText: "残り" }).waitFor({ timeout: 10000 });
    await shot(mp, "01_select_375.png");
    await mp.getByRole("button", { name: "マイページ" }).click();
    await shot(mp, "00_mypage_375.png");
    await mobile.close();

    // 31秒の動画: 送る前の案内 → アップグレード画面(価格・購入前の条件)→ 閉じる → そのまま送るとサーバーも断る
    await page.locator("#file").setInputFiles(long);
    let prechecked = false;
    try {
      await page.locator("#precheck").waitFor({ state: "visible", timeout: 8000 });
      prechecked = true;
    } catch (e) { log("note: ブラウザで長さを読めず、事前の案内は出ませんでした(サーバーの判定を確かめます)"); }
    const termsExpected = (await (await fetch(base + "/api/plans")).json()).purchase_terms;
    async function checkUpgrade(name) {
      const dlg = page.locator("#upgrade");
      await dlg.waitFor({ state: "visible", timeout: 10000 });
      const t = await dlg.textContent();
      for (const must of ["980", "1,980", "STANDARD", "PRO", "iOS アプリで購入できます", ...termsExpected])
        if (!t.includes(must)) throw new Error(`アップグレード画面に「${must}」がありません`);
      // 購入前の条件は購入ボタンより前にある。購入ボタンは無効
      const order = await page.evaluate(() => {
        const terms = document.getElementById("up-terms-box"), buy = document.querySelector("#upgrade button[disabled]");
        return !!buy && !!(terms.compareDocumentPosition(buy) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      if (!order) throw new Error("購入前の条件が購入ボタンの前にない、または購入ボタンが有効です");
      await shot(page, name);
      await page.locator("#up-close").click();
      await dlg.waitFor({ state: "hidden", timeout: 5000 });
    }
    if (prechecked) {
      const pt = await page.locator("#precheck").textContent();
      if (!pt.includes("1.0秒") || !pt.includes("30秒")) throw new Error("事前の案内に超過の秒数・上限がありません: " + pt);
      log("precheck:", (await page.locator("#precheck-msg").textContent()).trim());
      await shot(page, "08_precheck.png");
      await page.locator("#precheck").getByRole("button", { name: "プランと料金を見る" }).click();
      await checkUpgrade("09_upgrade.png");
      await page.setViewportSize({ width: 375, height: 812 });
      await page.locator("#precheck").getByRole("button", { name: "プランと料金を見る" }).click();
      await page.locator("#upgrade").waitFor({ state: "visible" });
      await shot(page, "09_upgrade_375.png", { fullPage: false });
      await page.locator("#up-close").click();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator("#precheck-send").click();
    }
    // サーバーの判定(over_plan_limit, upgrade: true)でもアップグレード画面が出る
    await page.locator("#error").waitFor({ state: "visible", timeout: 30000 });
    const em = await page.locator("#err-msg").textContent();
    if (!em.includes("上限")) throw new Error("上限超過のエラーが出ていません: " + em);
    await checkUpgrade("09_upgrade_server.png");
    if (!(await page.locator("#err-plans").isVisible())) throw new Error("エラー画面に「プランと料金を見る」がありません");
    const errBg = await page.evaluate(() => getComputedStyle(document.getElementById("error")).backgroundColor);
    if (errBg === "rgb(255, 255, 255)") throw new Error("エラー欄の背景が白のままです");
    await shot(page, "09_over_limit_error.png");
    log("over-limit flow OK (prechecked=" + prechecked + "):", em);
    await page.locator("#error [data-action=restart]").first().click();
    await page.locator("#step1").waitFor({ state: "visible" });

    // FREE で2本選ぶ → 送る前にアップグレード画面(送信はしない)
    await page.locator("#file").setInputFiles([video, video2]);
    await page.locator("#precheck").waitFor({ state: "visible", timeout: 8000 });
    if (await page.locator("#precheck-send").isVisible()) throw new Error("FREE の複数動画で「このまま送る」が出ています");
    const upr = await page.locator("#up-reason").textContent();
    if (!upr.includes("1本だけ")) throw new Error("複数動画の案内がありません: " + upr);
    await checkUpgrade("09_upgrade_multi.png");
    await shot(page, "09_multi_precheck.png");
    await page.locator("#precheck-other").click();
    log("FREE multi-video blocked before upload OK");

    await page.locator("#file").setInputFiles(video);
    // ② 解析中(速く終わると見えないことがある)
    try {
      await page.locator("#step2").waitFor({ state: "visible", timeout: 10000 });
      await shot(page, "02_analyzing.png");
    } catch (e) { log("note: 解析中の画面は撮れませんでした(すぐ終わった可能性)"); }

    // ③ 確認と修正
    await Promise.race([
      page.locator("#step3").waitFor({ state: "visible", timeout: 120000 }),
      page.locator("#error").waitFor({ state: "visible", timeout: 120000 }).then(async () => {
        throw new Error("エラー画面: " + await page.locator("#err-msg").textContent());
      }),
    ]);
    const rows = page.locator("#subs tbody tr");
    const n = await rows.count();
    if (n < 1) throw new Error("字幕が1件もありません");
    log("subtitles", n, "| 元の長さ", await page.locator("#dur-src").textContent(), "→", await page.locator("#dur-out").textContent());
    await shot(page, "03_review.png");
    const NEW = "スモークテストで修正";
    await page.getByLabel("字幕1の文言").fill(NEW);
    await page.getByRole("button", { name: "字幕1を保存" }).click();
    await rows.first().locator(".status").filter({ hasText: "保存しました" }).waitFor({ timeout: 10000 });
    const jobId = await page.evaluate(() => sessionStorage.getItem("vae_job"));
    const plan = await page.evaluate(async (id) => (await fetch(`/api/jobs/${id}/plan`)).json(), jobId);
    if (plan.subtitles[0].lines.join("") !== NEW) throw new Error("字幕の修正が保存されていません: " + JSON.stringify(plan.subtitles[0]));
    await shot(page, "03_review_edited.png");
    await page.setViewportSize({ width: 375, height: 812 });
    await shot(page, "03_review_375.png");
    await page.setViewportSize({ width: 1280, height: 900 });

    // ④ 書き出し
    await page.locator("#render-btn").click();
    await page.locator("#step4").waitFor({ state: "visible", timeout: 10000 });
    if (!(await page.locator("#step4 [data-action=cancel]").isVisible())) throw new Error("書き出し中にキャンセルがありません");
    if (!(await page.locator("#step4").textContent()).includes("利用回数は使いません")) throw new Error("キャンセルの案内がありません");
    await shot(page, "04_rendering.png");
    // ⑤ 完成
    await Promise.race([
      page.locator("#step5").waitFor({ state: "visible", timeout: 180000 }),
      page.locator("#error").waitFor({ state: "visible", timeout: 180000 }).then(async () => {
        throw new Error("エラー画面: " + await page.locator("#err-msg").textContent());
      }),
    ]);
    const src = await page.locator("#out-video").getAttribute("src");
    if (!src || !src.includes(`/api/jobs/${jobId}/output`)) throw new Error("完成動画の src がありません: " + src);
    const head = await page.evaluate(async (u) => { const r = await fetch(u, { headers: { Range: "bytes=0-1" } }); return [r.status, r.headers.get("content-type")]; }, src);
    if (head[0] !== 206 || head[1] !== "video/mp4") throw new Error("完成動画の配信が不正: " + head);
    try {
      await page.waitForFunction(() => document.getElementById("out-video").readyState >= 1, null, { timeout: 15000 });
      log("output <video> metadata loaded");
    } catch (e) { log("note: ブラウザで動画のメタデータを読めませんでした(このブラウザの対応コーデックの問題の可能性)"); }
    const dl = await page.locator("#download").getAttribute("href");
    if (!dl || !dl.includes("download=1")) throw new Error("ダウンロードのリンクがありません");
    const resTxt = await page.locator("#done-res").textContent();
    if (!resTxt.includes("FREE プラン") || !/\d+×\d+/.test(resTxt)) throw new Error("書き出しの解像度の表示がありません: " + resTxt);
    log("resolution:", resTxt);
    await page.locator("#reedit-remain").filter({ hasText: "1 回 / 1 回" }).waitFor({ timeout: 10000 });
    await page.locator("#acct-sum").filter({ hasText: "残り 2 / 3" }).waitFor({ timeout: 10000 });
    await shot(page, "05_done.png");
    await page.setViewportSize({ width: 375, height: 812 });
    await shot(page, "05_done_375.png");
    await page.setViewportSize({ width: 1280, height: 900 });

    // 書き出しに失敗したときの表示(T-16 / 独立レビュー2回目 N1)。
    // サーバーの状態の応答だけを書き換えて「失敗」にし、画面が失敗を知らせることを確かめる
    const failErr = { code: "verify_failed", message: "書き出した動画の確認で問題が見つかりました(テスト)。", hint: "もう一度書き出してください。", phase: "render" };
    for (const [state, boxId] of [["done", "#render-fail-5"], ["ready", "#render-fail-3"]]) {
      const pattern = new RegExp(`/api/jobs/${jobId}$`);
      await page.route(pattern, async (route) => {
        const resp = await route.fetch();
        const body = await resp.json();
        await route.fulfill({ response: resp, json: { ...body, state, stage: "render_failed", error: failErr } });
      });
      await page.reload();
      await page.locator(boxId).waitFor({ state: "visible", timeout: 15000 });
      const t = await page.locator(boxId).textContent();
      if (!t.includes("テスト") || !t.includes("もう一度書き出してください")) throw new Error(`${boxId} の文言が違います: ${t}`);
      await shot(page, `07_render_failed_${state}.png`);
      await page.unroute(pattern);
    }
    await page.reload();                                       // 本当の状態(done・失敗なし)に戻ると表示は消える
    await page.locator("#step5").waitFor({ state: "visible", timeout: 15000 });
    if (await page.locator("#render-fail-5").isVisible()) throw new Error("失敗がないのに #render-fail-5 が表示されています");
    log("render failure display OK");

    // 再書き出しへ戻れる
    await page.getByRole("button", { name: "字幕を直して再書き出し" }).click();
    await page.locator("#step3").waitFor({ state: "visible", timeout: 10000 });
    const val = await page.getByLabel("字幕1の文言").inputValue();
    if (val !== NEW) throw new Error("再編集の画面に修正が残っていません: " + val);
    // 字幕の手動変更の書き出しは回数を使わない
    await page.locator("#render-btn").click();
    await page.locator("#step4").waitFor({ state: "visible", timeout: 10000 });
    await page.locator("#step5").waitFor({ state: "visible", timeout: 180000 });
    await page.locator("#acct-sum").filter({ hasText: "残り 2 / 3" }).waitFor({ timeout: 10000 });
    await page.locator("#reedit-remain").filter({ hasText: "1 回 / 1 回" }).waitFor({ timeout: 10000 });
    log("manual re-render did not use quota");

    // AI 再編集(tempo): 版が1つ増え、残りが0になる
    const terms = await page.locator("#reedit-terms").textContent();
    if (!terms.includes("1回使います") || !terms.includes("回数を使いません") || !terms.includes("引き継ぎます")) throw new Error("AI 再編集の前の説明がありません: " + terms);
    await page.locator("#concept-re").getByLabel("テンポ重視").check();
    await page.locator("#ai-reedit-btn").click();
    await page.locator("#step2").waitFor({ state: "visible", timeout: 10000 });
    if (!(await page.locator("#step2 [data-action=cancel]").isVisible())) throw new Error("解析中にキャンセルがありません");
    await shot(page, "10_reedit_running.png");
    await Promise.race([
      page.locator("#step5").waitFor({ state: "visible", timeout: 180000 }),
      page.locator("#error").waitFor({ state: "visible", timeout: 180000 }).then(async () => {
        throw new Error("エラー画面: " + await page.locator("#err-msg").textContent());
      }),
    ]);
    if (await page.locator("#render-fail-5").isVisible()) throw new Error("AI 再編集が失敗しました: " + await page.locator("#render-fail-5").textContent());
    await page.locator("#reedit-remain").filter({ hasText: "0 回 / 1 回" }).waitFor({ timeout: 10000 });
    const nVer = await page.locator("#versions li").count();
    if (nVer !== 1) throw new Error("前の版の数が違います: " + nVer);
    const vurl = await page.locator("#versions li a").first().getAttribute("href");
    const vh = await page.evaluate(async (u) => { const r = await fetch(u, { headers: { Range: "bytes=0-1" } }); return [r.status, r.headers.get("content-type")]; }, vurl);
    if (vh[0] !== 206 || vh[1] !== "video/mp4") throw new Error("前の版の配信が不正: " + vh);
    await page.locator("#versions li").first().getByRole("button", { name: /再生/ }).click();
    await page.locator("#ver-video").waitFor({ state: "visible" });
    const job2 = await page.evaluate(async (id) => (await fetch(`/api/jobs/${id}`)).json(), jobId);
    if (!job2.settings || job2.settings.concept !== "tempo") throw new Error("コンセプトが tempo になっていません: " + JSON.stringify(job2.settings));
    const plan2 = await page.evaluate(async (id) => (await fetch(`/api/jobs/${id}/plan`)).json(), jobId);
    log("after AI reedit: versions", nVer, "| 字幕1 =", JSON.stringify(plan2.subtitles[0] && plan2.subtitles[0].lines.join("")),
        "(手動修正 " + (plan2.subtitles[0] && plan2.subtitles[0].lines.join("") === NEW ? "残る" : "置き換わる") + ")");
    await shot(page, "11_reedit_done.png");
    await page.setViewportSize({ width: 375, height: 812 });
    await shot(page, "11_reedit_done_375.png");
    await page.setViewportSize({ width: 1280, height: 900 });

    // 同じコンセプト → no_change(回数は使わない)
    await page.locator("#ai-reedit-btn").click();
    await page.locator("#reedit-status").filter({ hasText: "変更がないため処理しませんでした(回数は使っていません)" }).waitFor({ timeout: 10000 });
    if (!(await page.locator("#step5").isVisible())) throw new Error("no_change で完成画面から移動しました");
    await shot(page, "12_no_change.png");
    log("no_change OK");

    // FREE で使えないコンセプト → アップグレード画面。閉じても完成画面・ダウンロードはそのまま
    await page.locator("#concept-re").getByLabel(/落ち着いた雰囲気/).click();   // 選ぶと元に戻り、案内が出る
    await checkUpgrade("13_upgrade_concept.png");
    if (await page.locator("#concept-re").getByLabel(/落ち着いた雰囲気/).isChecked()) throw new Error("使えないコンセプトが選ばれたままです");
    // 残り0回で別のコンセプト → サーバーの limit_reached → アップグレード画面
    await page.locator("#concept-re").getByLabel("標準").check();
    await page.locator("#ai-reedit-btn").click();
    await page.locator("#upgrade").waitFor({ state: "visible", timeout: 10000 });
    const reason = await page.locator("#up-reason").textContent();
    if (!reason.includes("上限")) throw new Error("上限に達した理由がありません: " + reason);
    await checkUpgrade("14_upgrade_limit.png");
    if (!(await page.locator("#step5").isVisible()) || !(await page.locator("#download").isVisible())) throw new Error("アップグレード画面を閉じた後、完成画面が使えません");
    log("upgrade (concept / limit_reached) OK:", reason);

    // キャンセル(字幕の書き出しを始めて、すぐキャンセル)
    await page.getByRole("button", { name: "字幕を直して再書き出し" }).click();
    await page.locator("#step3").waitFor({ state: "visible", timeout: 10000 });
    await page.locator("#render-btn").click();
    await page.locator("#step4").waitFor({ state: "visible", timeout: 10000 });
    await page.locator("#step4 [data-action=cancel]").click();
    await page.locator("#step4 .cancel-status").filter({ hasText: "キャンセルしています" }).waitFor({ timeout: 5000 }).catch(() => {});
    await shot(page, "15_cancelling.png");
    await page.locator("#step5").waitFor({ state: "visible", timeout: 180000 });
    const cbox = page.locator("#render-fail-5");
    if (await cbox.isVisible()) {
      const ct = await cbox.textContent();
      if (!ct.includes("キャンセルしました") || !ct.includes("回数は使っていません")) throw new Error("キャンセルの表示が違います: " + ct);
      await shot(page, "16_cancelled.png");
      log("cancel OK:", ct.trim());
    } else log("note: キャンセルの前に書き出しが終わりました(キャンセルは段階の区切りで効くため)");
    await page.locator("#acct-sum").filter({ hasText: "残り 2 / 3" }).waitFor({ timeout: 10000 });
    await page.locator("#step5 [data-action=restart]").click();
    await page.locator("#step1").waitFor({ state: "visible" });

    // ---------------------------------------------------------------- STANDARD(DEV の購読)
    {
      const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ja-JP" });
      const sp = await sctx.newPage();
      sp.on("pageerror", (e) => pageErrors.push("[standard] " + String(e)));
      await sp.goto(base + "/");
      await sp.locator("#acct-sum").filter({ hasText: "残り 3 / 3" }).waitFor({ timeout: 10000 });
      const cid = (await sctx.cookies()).find((c) => c.name === "vae_client");
      if (!cid) throw new Error("vae_client の Cookie がありません");
      execFileSync(PY, ["-m", "vae", "dev-grant", "--client", cid.value, "--plan", "standard", "--data", data],
        { cwd: ROOT, env: { ...process.env, VAE_DEV_BILLING: "1" }, stdio: ["ignore", "ignore", "inherit"] });
      await sp.reload();
      await sp.locator("#acct-sum").filter({ hasText: "残り 15 / 15" }).waitFor({ timeout: 10000 });
      if (!(await sp.locator("#acct-sum").textContent()).includes("STANDARD")) throw new Error("STANDARD の表示がありません");
      await sp.getByRole("button", { name: "マイページ" }).click();
      const sExp = await sp.locator("#my-expires").textContent();
      const sRenew = await sp.locator("#my-renew").textContent();
      const sNew = await sp.locator("#my-new").textContent();
      if (!sExp.includes("日本時間") || !sRenew.includes("あり") || !sNew.includes("残り 15 本"))
        throw new Error(`STANDARD のマイページが違います: ${sExp} / ${sRenew} / ${sNew}`);
      log("standard mypage:", await sp.locator("#my-plan").textContent(), "|", sExp, "|", sRenew, "|", sNew);
      await shot(sp, "20_standard_mypage.png");
      await sp.setViewportSize({ width: 375, height: 812 });
      await shot(sp, "20_standard_mypage_375.png");
      await sp.setViewportSize({ width: 1280, height: 900 });
      await sp.locator("#mypage-close").click();
      if (await sp.locator("#concept-new .lock").count()) throw new Error("STANDARD で使えないコンセプトの印が出ています");

      // 合計が上限(180秒)を超える2本 → 送る前の案内
      await sp.locator("#file").setInputFiles([long150, long]);
      await sp.locator("#precheck").waitFor({ state: "visible", timeout: 15000 });
      const pre = await sp.locator("#precheck-msg").textContent();
      if (!pre.includes("合計") || !pre.includes("1.0秒")) throw new Error("合計時間の事前案内が違います: " + pre);
      log("standard precheck:", pre);
      await shot(sp, "21_standard_total_precheck.png");
      await sp.locator("#precheck-other").click();

      // 2本を1本にまとめる: 集める → 開始 → 結合・解析 → 確認 → 書き出し → 完成
      // 集めている画面を撮るため、開始の要求だけ少し遅らせる
      await sp.route(/\/api\/jobs\/[0-9a-f]+\/start$/, async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
      await sp.locator("#file").setInputFiles([video, video2]);
      await sp.locator("#collect").waitFor({ state: "visible", timeout: 30000 });
      await sp.locator("#clips li").nth(1).waitFor({ timeout: 30000 });
      const clipsTxt = await sp.locator("#collect").textContent();
      if (!clipsTxt.includes("smoke_talk.mp4") || !clipsTxt.includes("smoke_talk2.mp4") || !clipsTxt.includes("2本"))
        throw new Error("追加した動画の一覧が違います: " + clipsTxt);
      log("collect:", await sp.locator("#clips-total").textContent(), "|", await sp.locator("#clips-limit").textContent());
      await shot(sp, "22_collect.png");
      await sp.setViewportSize({ width: 375, height: 812 });
      await shot(sp, "22_collect_375.png");
      await sp.setViewportSize({ width: 1280, height: 900 });
      await Promise.race([
        sp.locator("#step3").waitFor({ state: "visible", timeout: 180000 }),
        sp.locator("#error").waitFor({ state: "visible", timeout: 180000 }).then(async () => {
          throw new Error("エラー画面(STANDARD): " + await sp.locator("#err-msg").textContent());
        }),
      ]);
      const srcDur = await sp.locator("#dur-src").textContent();
      if (parseFloat(srcDur) < 9) throw new Error("結合後の長さが短すぎます: " + srcDur);
      log("combined source:", srcDur, "→", await sp.locator("#dur-out").textContent(), "| subtitles", await sp.locator("#subs tbody tr").count());
      await shot(sp, "23_standard_review.png");
      await sp.locator("#render-btn").click();
      await Promise.race([
        sp.locator("#step5").waitFor({ state: "visible", timeout: 180000 }),
        sp.locator("#error").waitFor({ state: "visible", timeout: 180000 }).then(async () => {
          throw new Error("エラー画面(STANDARD): " + await sp.locator("#err-msg").textContent());
        }),
      ]);
      const sRes = await sp.locator("#done-res").textContent();
      if (!sRes.includes("STANDARD プラン") || !/\d+×\d+/.test(sRes)) throw new Error("STANDARD の解像度の表示が違います: " + sRes);
      log("standard resolution:", sRes);
      await sp.locator("#acct-sum").filter({ hasText: "残り 14 / 15" }).waitFor({ timeout: 10000 });
      await sp.locator("#reedit-remain").filter({ hasText: "3 回 / 3 回" }).waitFor({ timeout: 10000 });
      await shot(sp, "24_standard_done.png");
      await sp.setViewportSize({ width: 375, height: 812 });
      await shot(sp, "24_standard_done_375.png");
      await sctx.close();
      log("standard multi-video flow OK");
    }

    // エラー表示(対応していない形式)
    await page.locator("#file").setInputFiles(bad);
    await page.locator("#error").waitFor({ state: "visible", timeout: 10000 });
    const hint = await page.locator("#err-hint").textContent();
    if (!hint || !hint.includes("MP4")) throw new Error("対処が表示されていません: " + hint);
    await shot(page, "06_error.png");
    if (await page.locator("#upgrade").isVisible()) throw new Error("上限と関係ないエラーでアップグレード画面が出ました");
    await page.locator("#error [data-action=restart]").first().click();
    await page.locator("#step1").waitFor({ state: "visible" });

    if (pageErrors.length) throw new Error("ページの JavaScript エラー: " + pageErrors.join(" / "));
    log("PASS", shots.length, "screenshots");
  } finally {
    if (browser) await browser.close();
    srv.kill("SIGTERM");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("[ui_smoke] FAIL:", e && e.stack || e); process.exit(1); });
