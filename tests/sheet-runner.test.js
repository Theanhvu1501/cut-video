import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pLimit from "p-limit";
import { createSheetRunner, pickRandomBackground, pickDownloadDelay } from "../sheet/sheet-runner.js";
import { ST, skipText, MAX_ATTEMPTS } from "../sheet/resume-plan.js";

test("pickRandomBackground picks by rand", () => {
  const files = ["a.mp4", "b.mp4", "c.mp4"];
  assert.equal(pickRandomBackground(files, () => 0), "a.mp4");
  assert.equal(pickRandomBackground(files, () => 0.99), "c.mp4");
});

test("pickDownloadDelay: within [min,max], 0 when disabled", () => {
  assert.equal(pickDownloadDelay({ downloadDelayMinMs: 60000, downloadDelayMaxMs: 120000 }, () => 0), 60000);
  assert.equal(pickDownloadDelay({ downloadDelayMinMs: 60000, downloadDelayMaxMs: 120000 }, () => 0.5), 90000);
  assert.equal(pickDownloadDelay({ downloadDelayMinMs: 0, downloadDelayMaxMs: 0 }), 0);
});

test("second download is delayed but first is immediate", async () => {
  const slept = [];
  const { deps, calls } = makeDeps({
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/s.json", renderConcurrency: 2, downloadDelayMinMs: 90000, downloadDelayMaxMs: 90000 },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "K", enabled: true, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: "" },
        { rowIndex: 3, url: "u2", status: "" },
      ],
      setUrlStatus: async () => {},
    },
    sleep: async (ms) => { slept.push(ms); },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.downloaded.length, 2);
  assert.deepEqual(slept, [90000]); // chỉ chờ 1 lần: trước lượt tải thứ 2
});

test("kênh local: tự quét inputs/ và append tên file mới vào Sheet (dedup)", async () => {
  const appended = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 0, renderMode: "topTransparent", cfg: {}, proxy: "", videoSource: "local" },
      ],
      // "a.mp4" đã có sẵn trong Sheet → chỉ "b.mp4","c.mp4" là mới
      readChannelUrls: async () => [{ rowIndex: 2, url: "a.mp4", status: "done", uploadStatus: "✅" }],
      setUrlStatus: async () => {},
      appendUrls: async (name, urls) => { appended.push({ name, urls }); },
    },
    listLocalInputs: () => ["a.mp4", "b.mp4", "c.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out", inputsDir: "/in" }),
  });
  await createSheetRunner(deps).runNow();
  assert.equal(appended.length, 1);
  assert.equal(appended[0].name, "Kênh A");
  assert.deepEqual(appended[0].urls, ["b.mp4", "c.mp4"]);
});

test("kênh local: dùng copyLocalOverlay, render, set DONE; không proxy/không delay", async () => {
  const copied = [];
  const slept = [];
  const rendered = [];
  const { deps, calls } = makeDeps({
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/s.json", renderConcurrency: 2, downloadDelayMinMs: 90000, downloadDelayMaxMs: 90000 },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "socks5://bad", videoSource: "local" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "a.mp4", status: "", uploadStatus: "" },
        { rowIndex: 3, url: "b.mp4", status: "", uploadStatus: "" },
      ],
      setUrlStatus: async (n, r, s) => calls.status.push({ rowIndex: r, status: s }),
      appendUrls: async () => {},
    },
    listLocalInputs: () => ["a.mp4", "b.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out", inputsDir: "/in" }),
    copyLocalOverlay: (name, inputsDir, overlaysDir) => { copied.push({ name, inputsDir, overlaysDir }); return { filePath: `/ov/${name}`, title: name.replace(/\.[^.]+$/, "") }; },
    renderer: async (opts) => { rendered.push(opts); return { outputPath: opts.outputPath }; },
    sleep: async (ms) => { slept.push(ms); },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(copied.length, 2);
  assert.equal(copied[0].inputsDir, "/in");
  assert.equal(rendered.length, 2);
  assert.equal(rendered[0].overlayFile, "/ov/a.mp4");
  assert.equal(calls.status.filter((s) => s.status === ST.DONE).length, 2);
  assert.deepEqual(slept, []); // local KHÔNG delay dù cấu hình delay 90s
});

test("kênh local: proxy hỏng vẫn chạy (không dừng kênh)", async () => {
  const { deps, calls } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "socks5://bad", videoSource: "local" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "a.mp4", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      appendUrls: async () => {},
    },
    listLocalInputs: () => ["a.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out", inputsDir: "/in" }),
    copyLocalOverlay: (name) => ({ filePath: `/ov/${name}`, title: "a" }),
  });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.errors.length, 0); // proxy "bad" KHÔNG làm kênh local dừng
});

function makeDeps(overrides = {}) {
  const calls = { status: [], rendered: [], errors: [], downloaded: [], unlinked: [], cut: [], opened: [] };
  let savedState = {};
  let savedResume = {};
  const files = new Set(overrides.existingFiles || []);
  const deps = {
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2 },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: "", uploadStatus: "" },
        { rowIndex: 3, url: "u2", status: "", uploadStatus: "" },
        { rowIndex: 4, url: "u3", status: "", uploadStatus: "" },
        { rowIndex: 5, url: "u4", status: "done", uploadStatus: "" },
      ],
      setUrlStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status }),
      setUploadStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status, col: "C" }),
      appendUrls: async () => {},
    },
    listLocalInputs: () => [],
    copyLocalOverlay: (name) => ({ filePath: `/ov/${name}`, title: name.replace(/\.[^.]+$/, "") }),
    downloader: async (url) => {
      const filePath = `/ov/${url}.mp4`;
      // Mô phỏng yt-dlp noOverwrites: nếu file đích đã tồn tại, yt-dlp bỏ qua và
      // không tạo file mới -> pickDownloadedFile không thấy gì mới -> ném lỗi này.
      if (files.has(filePath)) throw new Error(`Không tìm thấy file tải về cho URL: ${url}`);
      calls.downloaded.push(url);
      files.add(filePath);
      return { filePath, title: url };
    },
    renderer: async ({ outputPath }) => { calls.rendered.push(outputPath); return { outputPath }; },
    listBackgrounds: () => ["bg1.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out" }),
    stateStore: { load: () => savedState, save: (s) => { savedState = JSON.parse(JSON.stringify(s)); } },
    resumeStore: { load: () => savedResume, save: (s) => { savedResume = JSON.parse(JSON.stringify(s)); } },
    fileExists: (p) => files.has(p),
    emit: (e) => { if (e.type === "error") calls.errors.push(e); },
    now: () => new Date(2026, 6, 7, 10, 0),
    pLimitFn: () => (fn) => fn(),
    rand: () => 0,
    unlink: (p) => { calls.unlinked.push(p); files.delete(p); },
    detectChroma: async () => "000000",
    sleep: async () => {},
    // Chỉ nhánh testRenderNow dùng ba dep này; runNow không đụng tới.
    // (loadPreset KHÔNG nằm ở đây: cả runChannel lẫn testRenderNow đều dùng bản import
    // ở đầu sheet-runner.js, muốn kiểm nhánh composer thì trỏ config.presetsDir đi chỗ khác.)
    cutClip: async (o) => { calls.cut.push(o); },
    openFile: (p) => calls.opened.push(p),
    ensureDir: () => {},
  };
  delete overrides.existingFiles;
  return { deps: { ...deps, ...overrides }, calls, getState: () => savedState, getResume: () => savedResume, files };
}

// I2 (bản vá theo review toàn nhánh 2026-08-08): renderOne bọc MỌI cảnh báo trong
// if (onProgress), nhưng renderer() cũng đẩy CẢ mọi dòng stderr của ffmpeg qua onProgress —
// nối thẳng renderer.onProgress vào emit({type:"log"}) là log ngập stderr của ffmpeg mỗi
// video. sheet-runner.js phải LỌC: chỉ log những dòng bắt đầu bằng "⚠️" (quy ước cảnh báo
// dùng xuyên codebase), bỏ mọi thứ khác.
test("renderer nhận onProgress: lọc CHỈ dòng bắt đầu bằng ⚠️, bỏ mọi dòng khác (kể cả stderr ffmpeg)", async () => {
  const seenOnProgress = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 1, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
    },
    renderer: async (opts) => {
      seenOnProgress.push(typeof opts.onProgress);
      // Mô phỏng đúng những gì renderOne thật đẩy qua onProgress: cảnh báo thật của composer/
      // blurFrame/crop VÀ một dòng stderr thô của ffmpeg (không có tiền tố ⚠️).
      opts.onProgress("⚠️ Lớp \"khung\" không tìm được file hợp lệ — bỏ qua lớp này");
      opts.onProgress("frame=  120 fps=30 q=23.0 size=    512kB time=00:00:04.00 bitrate=1048.6kbits/s");
      opts.onProgress("⚠️ GPU (h264_nvenc) không encode được, render lại bằng CPU. Lý do: x");
      return { outputPath: opts.outputPath };
    },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(seenOnProgress, ["function"], "renderer() PHẢI được truyền onProgress");
});

test("renderer nhận onProgress: dòng ⚠️ đi vào emit({type:'log'}), dòng thường (stderr ffmpeg) thì KHÔNG", async () => {
  const emitted = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 1, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
    },
    emit: (e) => { emitted.push(e); },
    renderer: async (opts) => {
      opts.onProgress("⚠️ Lớp \"khung\" không tìm được file hợp lệ — bỏ qua lớp này");
      opts.onProgress("frame=  120 fps=30 q=23.0 size=    512kB time=00:00:04.00 bitrate=1048.6kbits/s");
      return { outputPath: opts.outputPath };
    },
  });
  await createSheetRunner(deps).runNow();
  const logs = emitted.filter((e) => e.type === "log");
  assert.ok(logs.some((l) => l.message.includes("⚠️ Lớp") && l.message.includes("[Kênh A]")), "cảnh báo ⚠️ phải tới emit log, có tiền tố tên kênh");
  assert.ok(!logs.some((l) => l.message.includes("frame=")), "dòng stderr thô của ffmpeg KHÔNG được lọt vào log");
});

test("chromaKeyAuto: detectChroma sets cfg.chromaColor and gpu/speed pass through", async () => {
  const detectCalls = [];
  const renderCalls = [];
  const { deps } = makeDeps({
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/s.json", renderConcurrency: 2,
      videoSpeed: 0.8, useGPU: true, gpuVideoCodec: "h264_nvenc" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 1, renderMode: "chromaKeyAuto",
          cfg: { chromaColor: "FALLBACK", chromaSimilarity: 0.3 }, chromaPalette: ["22BDD6","2B4052"], proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "" }],
      setUrlStatus: async () => {},
    },
    detectChroma: async (videoPath, palette) => { detectCalls.push({ videoPath, palette }); return "2B4052"; },
    renderer: async (opts) => { renderCalls.push(opts); return { outputPath: opts.outputPath }; },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(detectCalls.length, 1);
  assert.deepEqual(detectCalls[0].palette, ["22BDD6","2B4052"]);
  assert.equal(renderCalls[0].cfg.chromaColor, "2B4052");
  assert.equal(renderCalls[0].cfg.videoSpeed, 0.8);
  assert.equal(renderCalls[0].useGPU, true);
  assert.equal(renderCalls[0].gpuVideoCodec, "h264_nvenc");
});

test("chromaKeyAuto without palette falls back to cfg.chromaColor, no detectChroma call", async () => {
  const detectCalls = [];
  const renderCalls = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 1, renderMode: "chromaKeyAuto",
          cfg: { chromaColor: "FALLBACK" }, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "" }],
      setUrlStatus: async () => {},
    },
    detectChroma: async () => { detectCalls.push(1); return "XXX"; },
    renderer: async (opts) => { renderCalls.push(opts); return { outputPath: opts.outputPath }; },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(detectCalls.length, 0);
  assert.equal(renderCalls[0].cfg.chromaColor, "FALLBACK");
});

test("runNow respects videosPerDay quota (2 of 3 pending)", async () => {
  const { deps, calls, getState } = makeDeps();
  const runner = createSheetRunner(deps);
  await runner.runNow();
  assert.equal(calls.downloaded.length, 2);
  assert.equal(calls.rendered.length, 2);
  // Mỗi item giờ ghi 2 lần: "đã tải" (sau khi tải xong) rồi "done" (sau khi render xong).
  assert.equal(calls.status.filter((s) => s.status === ST.DOWNLOADED).length, 2);
  assert.equal(calls.status.filter((s) => s.status === ST.DONE).length, 2);
  assert.equal(getState()["Kênh A"].countToday, 2);
});

test("runNow does nothing when quota already met today", async () => {
  const { deps, calls } = makeDeps({
    stateStore: { load: () => ({ "Kênh A": { lastRunDate: "2026-07-07", countToday: 2 } }), save: () => {} },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.downloaded.length, 0);
});

test("runNow records error and skips count when render throws", async () => {
  const { deps, calls, getState } = makeDeps({
    renderer: async () => { throw new Error("ffmpeg boom"); },
  });
  await createSheetRunner(deps).runNow();
  // Render lỗi (không phải tải lỗi) -> prefix "lỗi render:", không phải "error:".
  assert.equal(calls.status.filter((s) => s.status.startsWith(ST.ERR_RENDER)).length, 2);
  assert.equal(getState()["Kênh A"], undefined); // không render thành công nào
});

test("runNow errors channel with no backgrounds", async () => {
  const { deps, calls } = makeDeps({ listBackgrounds: () => [] });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.downloaded.length, 0);
  assert.ok(calls.errors.some((e) => /background/i.test(e.message)));
});

test("runNow skips channel when enabled is false", async () => {
  const { deps, calls } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: false, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "" }],
      setUrlStatus: async () => {},
    },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.downloaded.length, 0);
});

test("downloads are serialized (max concurrency 1) while renders run in parallel (max concurrency >= 2) with renderConcurrency:3", async () => {
  // Track download concurrency
  let activeDl = 0;
  let maxActiveDl = 0;
  // Track render concurrency
  let activeRender = 0;
  let maxActiveRender = 0;

  // Downloads are short (5ms each, serialized) so 3 downloads finish quickly at 0ms, 5ms, 10ms.
  // Renders are longer (30ms) so all 3 renders overlap — proving parallel render execution.
  const DOWNLOAD_HOLD_MS = 5;
  const RENDER_HOLD_MS = 30;

  const calls2 = { status: [], rendered: [], downloaded: [] };
  let savedState2 = {};
  const { deps } = makeDeps({
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 3 },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 3, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: "" },
        { rowIndex: 3, url: "u2", status: "" },
        { rowIndex: 4, url: "u3", status: "" },
      ],
      setUrlStatus: async (sheetName, rowIndex, status) => calls2.status.push({ sheetName, rowIndex, status }),
    },
    stateStore: { load: () => savedState2, save: (s) => { savedState2 = JSON.parse(JSON.stringify(s)); } },
    pLimitFn: (n) => pLimit(n),
    downloader: async (url) => {
      activeDl++;
      if (activeDl > maxActiveDl) maxActiveDl = activeDl;
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_HOLD_MS));
      activeDl--;
      calls2.downloaded.push(url);
      return { filePath: `/ov/${url}.mp4`, title: url };
    },
    renderer: async ({ outputPath }) => {
      activeRender++;
      if (activeRender > maxActiveRender) maxActiveRender = activeRender;
      await new Promise((resolve) => setTimeout(resolve, RENDER_HOLD_MS));
      activeRender--;
      calls2.rendered.push(outputPath);
      return { outputPath };
    },
  });

  await createSheetRunner(deps).runNow();

  assert.equal(calls2.downloaded.length, 3, "all 3 URLs downloaded");
  assert.equal(calls2.rendered.length, 3, "all 3 URLs rendered");
  assert.equal(maxActiveDl, 1, "downloads never overlapped — max concurrent downloads must be 1");
  assert.ok(maxActiveRender >= 2, `renders ran in parallel — expected max concurrent renders >= 2, got ${maxActiveRender}`);
});

test("runNow skips overlapping poll if already running", async () => {
  const logs = [];
  let resolveBlock;
  const blockPromise = new Promise((res) => { resolveBlock = res; });
  let callCount = 0;

  const calls3 = { status: [], downloaded: [] };
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => {
        callCount++;
        // First call blocks until we release it; subsequent calls resolve immediately
        if (callCount === 1) await blockPromise;
        return [{ sheetName: "Kênh A", enabled: false, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" }];
      },
      readChannelUrls: async () => [],
      setUrlStatus: async (sheetName, rowIndex, status) => calls3.status.push({ sheetName, rowIndex, status }),
    },
    emit: (e) => { if (e.type === "log") logs.push(e.message); },
    pLimitFn: (n) => pLimit(n),
  });

  const runner = createSheetRunner(deps);
  // Start first run (will block at readConfigSheet)
  const first = runner.runNow();
  // Attempt second run while first is still in flight — should be skipped
  await runner.runNow();
  // Now release the block so first run can finish
  resolveBlock();
  await first;

  assert.ok(logs.some((m) => /bỏ qua/i.test(m)), "second runNow should emit a skip log message");
});

test("refreshStats chạy một lần, sau khi đã emit done", async () => {
  const order = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [],
      readChannelUrls: async () => [],
      setUrlStatus: async () => {},
    },
    emit: (e) => order.push(e.type),
    refreshStats: async () => { order.push("refresh"); },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(order, ["done", "refresh"]);
});

test("không có refreshStats thì runNow vẫn chạy bình thường", async () => {
  const { deps, calls } = makeDeps();
  await createSheetRunner(deps).runNow();
  assert.equal(calls.downloaded.length, 2);
});

test("refreshStats ném lỗi: ghi log, lượt chạy vẫn done, runNow không reject", async () => {
  const events = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [],
      readChannelUrls: async () => [],
      setUrlStatus: async () => {},
    },
    emit: (e) => events.push(e),
    refreshStats: async () => { throw new Error("quotaExceeded"); },
  });
  await createSheetRunner(deps).runNow(); // không được reject
  assert.ok(events.some((e) => e.type === "done"));
  assert.ok(events.some((e) => e.type === "log" && /quotaExceeded/.test(e.message)));
  assert.equal(events.filter((e) => e.type === "error").length, 0);
});

test("render-only: bỏ qua bước tải khi file overlay còn trên đĩa", async () => {
  const { deps, calls } = makeDeps({
    existingFiles: ["/ov/u1.mp4"],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: ST.DOWNLOADED, uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.downloaded, []);
  assert.deepEqual(calls.rendered, ["/out/u1.mp4"]);
});

test("đã tải nhưng file bị xoá tay -> tải lại từ đầu", async () => {
  const { deps, calls } = makeDeps({
    existingFiles: [],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: ST.DOWNLOADED, uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.downloaded, ["u1"]);
});

test("render lỗi: giữ file overlay, ghi 'lỗi render:', tăng attempts", async () => {
  const { deps, calls, getResume } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async (s, r, status) => calls.status.push({ rowIndex: r, status }),
      setUploadStatus: async () => {},
    },
    renderer: async () => { throw new Error("ffmpeg chết"); },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.unlinked, []); // KHÔNG xoá file khi render lỗi
  const last = calls.status.at(-1);
  assert.ok(last.status.startsWith(ST.ERR_RENDER), last.status);
  assert.equal(getResume()["Kênh A"].u1.attempts, 1);
});

// I1(a) (bản vá theo review toàn nhánh 2026-08-08, thay cho hành vi Task 10 cũ): composer với
// preset không đọc được phải bị CHẶN TRƯỚC KHI TẢI bất kỳ video nào của kênh đó — nạp + kiểm
// preset MỘT LẦN cho cả kênh trước Promise.all, không phải mỗi item SAU KHI đã tải xong (cách
// cũ). Cách cũ tốn một lượt tải yt-dlp/băng thông proxy/hạn mức rate-limit cho MỌI item trước
// khi thất bại lần lượt — đúng cái giá spec "Preset không tồn tại -> bỏ qua kênh đó" muốn
// tránh. Vẫn phải ghi lỗi rõ vào Sheet + emit "error"/"channel-status", và kênh khác không bị
// ảnh hưởng.
test("composer: preset không đọc được -> BỎ QUA kênh TRƯỚC KHI TẢI, ghi lỗi vào Sheet, kênh khác vẫn chạy", async () => {
  const emitted = [];
  const { deps, calls, getResume } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "composer", presetName: "khong-ton-tai", slotOverrides: {}, cfg: {}, proxy: "" },
        { sheetName: "Kênh B", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      // config.presetsDir không được truyền (đúng thực tế trước khi electron-main.js nối ở
      // Giai đoạn 2) -> loadPreset tự trả null qua try/catch của chính nó, không cần mock.
      readChannelUrls: async (sheetName) => (sheetName === "Kênh A"
        ? [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }]
        : [{ rowIndex: 2, url: "u2", status: "", uploadStatus: "" }]),
      setUrlStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status }),
      setUploadStatus: async () => {},
    },
    emit: (e) => { emitted.push(e); if (e.type === "error") calls.errors.push(e); },
  });
  await createSheetRunner(deps).runNow();

  // (a) KHÔNG được tải u1: preset hỏng phải chặn TRƯỚC download, không phải tốn một lượt tải
  // yt-dlp rồi mới thất bại ở bước render như trước.
  assert.ok(!calls.downloaded.includes("u1"), "không được tải u1 khi preset hỏng");
  assert.ok(!calls.unlinked.some((p) => /u1/.test(p)), "không có gì để xoá vì chưa tải gì");
  // (b) KHÔNG có entry resume cho u1: chưa hề chạm tới bước download/render nào của nó.
  assert.equal(getResume()["Kênh A"]?.u1, undefined);
  // (c) ô trạng thái Sheet của Kênh A phải ghi lỗi preset (không phải "đã tải").
  const errStatus = calls.status.filter((s) => s.sheetName === "Kênh A").at(-1);
  assert.ok(errStatus, "phải ghi trạng thái lỗi vào Sheet cho Kênh A");
  assert.ok(errStatus.status.startsWith(ST.ERR_RENDER), `expected "${ST.ERR_RENDER}", got "${errStatus.status}"`);
  assert.match(errStatus.status, /không đọc được preset/);
  // (d) emit đúng mức nghiêm trọng: type "error" + "channel-status", không phải "log" nhẹ nhàng.
  assert.ok(calls.errors.some((e) => e.channel === "Kênh A" && /không đọc được preset/.test(e.message)));
  assert.ok(emitted.some((e) => e.type === "channel-status" && e.channel === "Kênh A" && e.status === "lỗi preset"));
  // (e) Kênh B không dùng composer: không bị ảnh hưởng, vẫn render bình thường.
  assert.equal(calls.rendered.filter((p) => /u2/.test(p)).length, 1, "Kênh B vẫn phải render");
});

test("composer: preset đọc được nhưng KHÔNG hợp lệ (vd. thiếu lớp overlay) -> cũng bị chặn TRƯỚC KHI TẢI", async () => {
  // validatePreset là lớp chắn thứ hai bên trong khối kiểm của I1(a) — không chỉ "đọc được
  // hay không". Dùng presetsDir trỏ vào một thư mục tạm chứa preset thật (không mock
  // loadPreset) để bài test đi qua đúng đường validatePreset thật.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preset-invalid-"));
  fs.writeFileSync(
    path.join(dir, "hong.json"),
    JSON.stringify({ version: 1, name: "hong", layers: [{ id: "bg", source: { type: "background" }, geometry: { fit: "full" } }] })
  );
  const { deps, calls } = makeDeps({
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, presetsDir: dir },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "composer", presetName: "hong", slotOverrides: {}, cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status }),
      setUploadStatus: async () => {},
    },
  });
  await createSheetRunner(deps).runNow();
  fs.rmSync(dir, { recursive: true, force: true });

  assert.ok(!calls.downloaded.includes("u1"), "không được tải u1 khi preset không hợp lệ");
  const errStatus = calls.status.filter((s) => s.sheetName === "Kênh A").at(-1);
  assert.ok(errStatus, "phải ghi trạng thái lỗi vào Sheet");
  assert.match(errStatus.status, /không hợp lệ.*đúng một lớp video gốc/);
});

test("render xong: xoá overlay, ghi done, lưu outputPath", async () => {
  const { deps, calls, getResume } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.unlinked, ["/ov/u1.mp4"]);
  const e = getResume()["Kênh A"].u1;
  assert.equal(e.stage, "rendered");
  assert.equal(e.outputPath, "/out/u1.mp4");
});

test("chạm trần 3 lần -> ghi 'bỏ qua:' vào cột B", async () => {
  const { deps, calls } = makeDeps({
    existingFiles: ["/ov/u1.mp4"],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: `${ST.ERR_RENDER} x`, uploadStatus: "" }],
      setUrlStatus: async (s, r, status) => calls.status.push({ rowIndex: r, status }),
      setUploadStatus: async () => {},
    },
    renderer: async () => { throw new Error("ffmpeg chết"); },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: MAX_ATTEMPTS - 1, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.status.at(-1).status, skipText("ffmpeg chết"));
});

test("ô B rỗng nhưng overlay cũ còn: xoá file cũ rồi mới tải lại", async () => {
  const { deps, calls, getResume } = makeDeps({
    existingFiles: ["/ov/u1.mp4"],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 2, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.unlinked[0], "/ov/u1.mp4"); // xoá overlay cũ TRƯỚC khi tải
  assert.deepEqual(calls.downloaded, ["u1"]);
  assert.equal(getResume()["Kênh A"].u1.attempts, 0); // reset vì ô B rỗng
});

test("render-only không xoá overlay đang cần dùng", async () => {
  const { deps, calls } = makeDeps({
    existingFiles: ["/ov/u1.mp4"],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: ST.DOWNLOADED, uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.downloaded, []);
  // Overlay chỉ bị xoá đúng 1 lần, SAU khi render thành công — không bị dọn trước.
  assert.equal(calls.unlinked.length, 1);
  assert.equal(calls.unlinked[0], "/ov/u1.mp4");
});

test("lỗi render: giữ nguyên attempts, không reset", async () => {
  const { deps, calls, getResume } = makeDeps({
    existingFiles: ["/ov/u1.mp4"],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: `${ST.ERR_RENDER} x`, uploadStatus: "" }],
      setUrlStatus: async (s, r, status) => calls.status.push({ rowIndex: r, status }),
      setUploadStatus: async () => {},
    },
    renderer: async () => { throw new Error("ffmpeg chết"); },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 2, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.equal(getResume()["Kênh A"].u1.attempts, 3);
  assert.equal(calls.status.at(-1).status, skipText("ffmpeg chết"));
});

test("proxy hỏng -> bỏ qua cả kênh, không tải gì", async () => {
  const { deps, calls } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "rác" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.downloaded, []);
  assert.match(calls.errors.at(-1).message, /Proxy không hợp lệ/);
});

test("proxy thiếu scheme được chuẩn hoá rồi truyền xuống downloader", async () => {
  const seen = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "1.2.3.4:8080" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    downloader: async (url, dir, opts) => { seen.push(opts.proxy); return { filePath: `/ov/${url}.mp4`, title: url }; },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(seen, ["http://1.2.3.4:8080"]);
});

test("upload-only: không tải, không render, chỉ đưa vào hàng đợi upload", async () => {
  const enqueued = [];
  const { deps, calls } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: GPM chết" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.downloaded, []);
  assert.deepEqual(calls.rendered, []);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].videoPath, "/out/u1.mp4");
  assert.equal(enqueued[0].sourceUrl, "u1");
});

test("upload-only tăng uploadAttempts mỗi lượt", async () => {
  const { deps, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: x" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: () => {}, beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 1, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.equal(getResume()["Kênh A"].u1.uploadAttempts, 2);
});

test("upload-only không bị quota cắt kể cả khi đã đủ video hôm nay", async () => {
  const enqueued = [];
  const { deps, calls } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 1, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: x" },
        { rowIndex: 3, url: "u2", status: "", uploadStatus: "" },
      ],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  // Đã render 1 video hôm nay -> remaining = 0.
  deps.stateStore.save({ "Kênh A": { lastRunDate: "2026-07-07", countToday: 1 } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.rendered, []);            // quota chặn u2
  assert.equal(enqueued.length, 1);                // nhưng u1 vẫn được upload lại
  assert.equal(enqueued[0].sourceUrl, "u1");
});

test("upload hết lượt thử -> ghi 'bỏ qua:' vào cột C, không enqueue", async () => {
  const enqueued = [];
  const upStatus = [];
  const { deps } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: GPM chết" }],
      setUrlStatus: async () => {},
      setUploadStatus: async (s, r, status) => upStatus.push(status),
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: MAX_ATTEMPTS, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(enqueued, []);
  assert.equal(upStatus.at(-1), skipText("GPM chết"));
});

test("GPM tắt: upload-only không tăng uploadAttempts và không chôn video", async () => {
  const enqueued = [];
  const upStatus = [];
  const logs = [];
  const { deps, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: false, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: GPM chết" }],
      setUrlStatus: async () => {},
      setUploadStatus: async (s, r, status) => upStatus.push(status),
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
    emit: (e) => { if (e.type === "log") logs.push(e); },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });

  const runner = createSheetRunner(deps);
  await runner.runNow();
  await runner.runNow();
  await runner.runNow();

  assert.deepEqual(enqueued, []); // GPM tắt: không bao giờ enqueue
  assert.equal(getResume()["Kênh A"].u1.uploadAttempts ?? 0, 0); // không tăng bộ đếm
  assert.deepEqual(upStatus, []); // không ghi "bỏ qua:" vào cột C -> không bị chôn
  assert.ok(logs.length >= 1, "phải có ít nhất một sự kiện log giải thích lý do bỏ qua");
});

test("kênh thiếu gpmProfileId: upload-only không tăng uploadAttempts", async () => {
  const enqueued = [];
  const { deps, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: GPM chết" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(enqueued, []);
  assert.equal(getResume()["Kênh A"].u1.uploadAttempts ?? 0, 0);
});

test("GPM bật đầy đủ: upload-only vẫn tăng uploadAttempts và enqueue", async () => {
  const enqueued = [];
  const { deps, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: GPM chết" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.equal(enqueued.length, 1);
  assert.equal(getResume()["Kênh A"].u1.uploadAttempts, 1);
});

// ── Lỗi hạ tầng (quên mở GPM, GPM đang mở tay, hết slot) ────────────────────
// Cột C = "⏸ chờ:" → thử lại mãi nhưng KHÔNG tính uploadAttempts, để một sự cố
// ngoài video không chôn video sau 3 lượt.

const gpmChannel = {
  sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent",
  cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00",
};
const gpmConfig = {
  spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json",
  renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi",
};

test("cột C = ⏸ chờ -> upload lại nhưng KHÔNG tăng uploadAttempts", async () => {
  const enqueued = [];
  const { deps, calls, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: gpmConfig,
    sheetsApi: {
      readConfigSheet: async () => [gpmChannel],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: "done", uploadStatus: `${ST.WAIT_UPLOAD} chưa kết nối được GPM` },
      ],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
  });
  // uploadAttempts đã chạm trần: nếu bị tính lượt thì video này đã bị chôn.
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: MAX_ATTEMPTS, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();

  assert.equal(enqueued.length, 1, "phải upload lại");
  assert.equal(getResume()["Kênh A"].u1.uploadAttempts, MAX_ATTEMPTS, "không được tăng");
  assert.deepEqual(calls.rendered, [], "không render lại");
  assert.ok(!calls.status.some((s) => /bỏ qua/.test(s.status)), "không được đánh dấu bỏ qua");
});

test("GPM chưa mở (preflight hỏng) -> không enqueue, ghi ⏸ vào cột C cho video vừa render", async () => {
  const enqueued = [];
  const { deps, calls } = makeDeps({
    config: gpmConfig,
    sheetsApi: {
      readConfigSheet: async () => [gpmChannel],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async (n, r, s) => calls.status.push({ rowIndex: r, status: s }),
      setUploadStatus: async (n, r, s) => calls.status.push({ rowIndex: r, status: s, col: "C" }),
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
    checkGpm: async () => { throw new Error("fetch failed"); },
  });
  await createSheetRunner(deps).runNow();

  assert.equal(calls.rendered.length, 1, "render vẫn phải chạy bình thường");
  assert.deepEqual(enqueued, [], "GPM chết thì đừng phí 10s CDP cho từng video");
  const c = calls.status.filter((s) => s.col === "C");
  assert.equal(c.length, 1);
  assert.ok(c[0].status.startsWith(ST.WAIT_UPLOAD), `cột C = ${c[0].status}`);
  assert.ok(/fetch failed/.test(c[0].status), "phải nói rõ lý do");
});

test("GPM chưa mở: video đang chờ upload lại cũng chỉ ghi ⏸, không tính lượt", async () => {
  const { deps, calls, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: gpmConfig,
    sheetsApi: {
      readConfigSheet: async () => [gpmChannel],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: x" }],
      setUrlStatus: async () => {},
      setUploadStatus: async (n, r, s) => calls.status.push({ rowIndex: r, status: s, col: "C" }),
    },
    uploadQueue: { enqueue: () => {}, beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
    checkGpm: async () => false,
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();

  assert.equal(getResume()["Kênh A"].u1.uploadAttempts, 0);
  assert.ok(calls.status.some((s) => s.col === "C" && s.status.startsWith(ST.WAIT_UPLOAD)));
});

test("preflight chỉ chạy 1 lần cho cả lượt, và bỏ qua khi GPM tắt trong cấu hình", async () => {
  let checks = 0;
  const { deps } = makeDeps({
    config: gpmConfig,
    sheetsApi: {
      readConfigSheet: async () => [gpmChannel, { ...gpmChannel, sheetName: "Kênh B" }],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: () => {}, beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
    checkGpm: async () => { checks++; return true; },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(checks, 1, "2 kênh nhưng chỉ hỏi GPM 1 lần");

  checks = 0;
  const off = makeDeps({
    config: { ...gpmConfig, gpmEnabled: false },
    sheetsApi: {
      readConfigSheet: async () => [gpmChannel],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    checkGpm: async () => { checks++; return true; },
  });
  await createSheetRunner(off.deps).runNow();
  assert.equal(checks, 0, "GPM tắt trong cấu hình thì khỏi hỏi");
});

// Kịch bản thật: quên mở phần mềm GPM → lượt 1 render xong nhưng không upload được.
// Mở GPM lên → lượt sau (hẹn giờ pollSec) phải TỰ upload, không cần đụng tay vào Sheet.
test("quên mở GPM: lượt sau mở lên thì tự upload lại", async () => {
  const enqueued = [];
  const colC = new Map();          // rowIndex -> nội dung cột C, giữ giữa 2 lượt
  const colB = new Map();
  let gpmUp = false;

  const { deps, calls, getResume, files } = makeDeps({
    config: gpmConfig,
    sheetsApi: {
      readConfigSheet: async () => [gpmChannel],
      // Đọc lại Sheet mỗi lượt, phản ánh đúng những gì lượt trước đã ghi.
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: colB.get(2) ?? "", uploadStatus: colC.get(2) ?? "" },
      ],
      setUrlStatus: async (n, r, s) => colB.set(r, s),
      setUploadStatus: async (n, r, s) => colC.set(r, s),
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
    checkGpm: async () => { if (!gpmUp) throw new Error("fetch failed"); return true; },
  });
  const runner = createSheetRunner(deps);

  // ── Lượt 1: chưa mở GPM ────────────────────────────────────────────────────
  await runner.runNow();
  assert.equal(calls.rendered.length, 1, "render vẫn chạy dù GPM chưa mở");
  assert.deepEqual(enqueued, []);
  assert.equal(colB.get(2), ST.DONE);
  assert.ok(colC.get(2).startsWith(ST.WAIT_UPLOAD), `cột C = ${colC.get(2)}`);

  // ── Lượt 2: người dùng đã mở GPM, không sửa gì trong Sheet ─────────────────
  gpmUp = true;
  files.add("/out/u1.mp4"); // file render của lượt 1 vẫn nằm đó
  await runner.runNow();

  assert.equal(enqueued.length, 1, "phải tự upload lại");
  assert.equal(enqueued[0].videoPath, "/out/u1.mp4");
  assert.equal(enqueued[0].sourceUrl, "u1");
  assert.equal(calls.rendered.length, 1, "KHÔNG được render lại");
  assert.deepEqual(calls.downloaded, ["u1"], "KHÔNG được tải lại");
  assert.equal(getResume()["Kênh A"].u1.uploadAttempts, 0, "quên mở GPM không phải lỗi của video");
});

test("video hoàn tất (done + ✅) thì entry resume bị xoá", async () => {
  const { deps, calls, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "✅ lên lịch 10/07 07:00" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 1, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.equal(getResume()["Kênh A"], undefined);
  assert.deepEqual(calls.downloaded, []);
  assert.deepEqual(calls.rendered, []);
  assert.deepEqual(calls.unlinked, []); // KHÔNG xoá file nào, chỉ xoá entry JSON
});

test("video done nhưng chưa upload xong thì entry vẫn còn", async () => {
  const { deps, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "⏳ đang upload" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 1, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.ok(getResume()["Kênh A"]?.u1, "entry u1 phải còn vì upload-only lượt sau cần outputPath/title");
});

test("video done + ❌ (upload lỗi) thì entry vẫn còn", async () => {
  const enqueued = [];
  const { deps, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: x" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j), beginRun: () => {}, endRun: () => {}, endChannel: () => {} },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.ok(getResume()["Kênh A"]?.u1, "entry u1 phải còn — nhánh upload-only không bị cướp mất");
  assert.equal(getResume()["Kênh A"].u1.uploadAttempts, 1);
});

test("endChannel: được gọi cho MỌI kênh, kể cả kênh thoát sớm vì lỗi", async () => {
  const ended = [];
  const { deps } = makeDeps({
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        // Kênh A: proxy sai -> runChannel return ngay ở đầu
        { sheetName: "Kênh A", enabled: true, videosPerDay: 1, renderMode: "topTransparent", cfg: {}, proxy: "://sai" },
        // Kênh B: không có background -> cũng return sớm
        { sheetName: "Kênh B", enabled: true, videosPerDay: 1, renderMode: "topTransparent", cfg: {}, proxy: "" },
        // Kênh C: chạy bình thường
        { sheetName: "Kênh C", enabled: true, videosPerDay: 1, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    listBackgrounds: (dir) => (dir === "/bg-B" ? [] : ["bg1.mp4"]),
    ensureDirs: (root) => ({
      backgroundsDir: root.includes("Kênh B") ? "/bg-B" : "/bg",
      overlaysDir: "/ov", outputDir: "/out",
    }),
    uploadQueue: {
      enqueue: () => {}, beginRun: () => {}, endRun: () => {},
      endChannel: (name) => ended.push(name),
    },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(ended, ["Kênh A", "Kênh B", "Kênh C"]);
});

// ===================== testRenderNow: nút "Test render" của tab Sheet =====================
// Nhánh xem thử: mỗi kênh 1 video, cắt ngắn, render, mở lên xem. Không upload, không
// ghi Sheet, không tính quota. Lõi nằm ở sheet/test-render-channel.js; ở đây chỉ kiểm
// phần điều phối: chọn kênh nào, chạy tuần tự, lỗi kênh này không giết kênh kia.

function makeTestRenderDeps(overrides = {}) {
  const { deps, calls } = makeDeps({
    // ensureDirs của makeDeps trả "/bg","/ov","/out" cố định cho mọi kênh — nhánh
    // test-render cần đường dẫn theo từng kênh mới phân biệt được kênh nào ra kênh nào.
    ensureDirs: (root) => ({
      backgroundsDir: path.join(root, "backgrounds"),
      overlaysDir: path.join(root, "overlays"),
      outputDir: path.join(root, "output"),
      inputsDir: path.join(root, "inputs"),
    }),
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" },
        { sheetName: "Kênh B", enabled: true, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" },
        { sheetName: "Kênh tắt", enabled: false, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "✅" }],
      setUrlStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status }),
      setUploadStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status, col: "C" }),
      appendUrls: async () => {},
    },
    ...overrides,
  });
  return { deps, calls };
}

test("testRenderNow: chạy mọi kênh ĐANG BẬT, bỏ kênh tắt", async () => {
  const { deps, calls } = makeTestRenderDeps();
  await createSheetRunner(deps).testRenderNow();
  assert.equal(calls.opened.length, 2, "hai kênh bật thì mở hai video, kênh tắt không chạy");
  assert.ok(calls.opened[0].includes("Kênh A"));
  assert.ok(calls.opened[1].includes("Kênh B"));
  assert.ok(!calls.opened.some((f) => f.includes("Kênh tắt")));
});

test("testRenderNow(tên kênh): chỉ chạy đúng kênh đó", async () => {
  const { deps, calls } = makeTestRenderDeps();
  await createSheetRunner(deps).testRenderNow("Kênh B");
  assert.equal(calls.opened.length, 1);
  assert.ok(calls.opened[0].includes("Kênh B"));
});

test("testRenderNow: không ghi cột B/C, không tính quota, không enqueue upload", async () => {
  const enqueued = [];
  const { deps, calls, getState } = (() => {
    const made = makeDeps({
      sheetsApi: {
        readConfigSheet: async () => [
          { sheetName: "Kênh A", enabled: true, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "08:00" },
        ],
        readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
        setUrlStatus: async (n, r, s) => made.calls.status.push({ n, r, s }),
        setUploadStatus: async (n, r, s) => made.calls.status.push({ n, r, s, col: "C" }),
        appendUrls: async () => {},
      },
      config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/s.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h" },
      uploadQueue: { enqueue: (j) => enqueued.push(j), endChannel: () => {}, beginRun: () => {}, endRun: () => {} },
    });
    return made;
  })();
  await createSheetRunner(deps).testRenderNow();
  assert.deepEqual(calls.status, [], "không được ghi vào Sheet");
  assert.deepEqual(enqueued, [], "không được đưa vào hàng đợi upload");
  assert.deepEqual(getState(), {}, "không được tính vào quota hôm nay");
});

test("testRenderNow: kênh lỗi chỉ báo lỗi kênh đó, kênh sau vẫn chạy", async () => {
  const { deps, calls } = makeTestRenderDeps({
    listBackgrounds: (dir) => (String(dir).includes("Kênh A") ? [] : ["bg1.mp4"]),
  });
  await createSheetRunner(deps).testRenderNow();
  assert.equal(calls.errors.length, 1);
  assert.equal(calls.errors[0].channel, "Kênh A");
  assert.equal(calls.opened.length, 1);
  assert.ok(calls.opened[0].includes("Kênh B"));
});

test("testRenderNow: chờ giữa hai lượt tải như luồng thật (né bot-check)", async () => {
  const slept = [];
  const { deps } = makeTestRenderDeps({
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/s.json", renderConcurrency: 2, downloadDelayMinMs: 90000, downloadDelayMaxMs: 90000 },
    sleep: async (ms) => { slept.push(ms); },
  });
  await createSheetRunner(deps).testRenderNow();
  assert.deepEqual(slept, [90000], "kênh đầu tải ngay, kênh thứ hai mới phải chờ");
});

test("testRenderNow: bỏ qua khi lượt chạy thật đang chạy dở", async () => {
  let release;
  const blocked = new Promise((r) => { release = r; });
  const { deps, calls } = makeTestRenderDeps({
    renderer: async ({ outputPath }) => { await blocked; calls0.rendered.push(outputPath); return { outputPath }; },
  });
  const calls0 = calls;
  const runner = createSheetRunner(deps);
  const real = runner.runNow();
  await runner.testRenderNow();
  assert.deepEqual(calls.opened, [], "không được chạy test chồng lên lượt thật");
  release();
  await real;
});

test("runNow bỏ qua khi testRenderNow đang chạy dở", async () => {
  let release;
  const blocked = new Promise((r) => { release = r; });
  const { deps, calls } = makeTestRenderDeps({
    cutClip: async () => { await blocked; },
  });
  const runner = createSheetRunner(deps);
  const test1 = runner.testRenderNow("Kênh A");
  await runner.runNow();
  assert.deepEqual(calls.rendered, [], "không được chạy lượt thật chồng lên test");
  release();
  await test1;
});
