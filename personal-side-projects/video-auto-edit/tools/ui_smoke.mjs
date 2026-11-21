// UI の実際の操作テスト(AC-U1〜U5, AC-S6)。モデルを使わない偽の文字起こしでサーバーを起動し、
// 見出しのない Chromium で「選ぶ → 解析 → 字幕修正 → 書き出し → 完成」まで操作する。
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

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const srvLog = fs.openSync(path.join(outDir, "server.log"), "w");
  const srv = spawn(PY, ["-m", "vae", "web", "--host", "127.0.0.1", "--port", String(port), "--data", data],
    { cwd: ROOT, env: { ...process.env, VAE_FAKE_TRANSCRIBER: "1" }, stdio: ["ignore", srvLog, srvLog] });
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
    await shot(page, "01_select.png");
    const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "ja-JP", isMobile: true });
    const mp = await mobile.newPage();
    await mp.goto(base + "/");
    await shot(mp, "01_select_375.png");
    await mobile.close();

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
    await shot(page, "05_done.png");
    await page.setViewportSize({ width: 375, height: 812 });
    await shot(page, "05_done_375.png");
    await page.setViewportSize({ width: 1280, height: 900 });

    // 再書き出しへ戻れる
    await page.getByRole("button", { name: "字幕を直して再書き出し" }).click();
    await page.locator("#step3").waitFor({ state: "visible", timeout: 10000 });
    const val = await page.getByLabel("字幕1の文言").inputValue();
    if (val !== NEW) throw new Error("再編集の画面に修正が残っていません: " + val);

    // エラー表示(対応していない形式)
    await page.locator("#step3 [data-action=restart]").click();
    await page.locator("#step1").waitFor({ state: "visible" });
    await page.locator("#file").setInputFiles(bad);
    await page.locator("#error").waitFor({ state: "visible", timeout: 10000 });
    const hint = await page.locator("#err-hint").textContent();
    if (!hint || !hint.includes("MP4")) throw new Error("対処が表示されていません: " + hint);
    await shot(page, "06_error.png");
    await page.locator("#error [data-action=restart]").click();
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
