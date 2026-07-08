import { test } from "node:test";
import assert from "node:assert/strict";
import pLimit from "p-limit";
import { createSheetRunner, pickRandomBackground } from "../sheet/sheet-runner.js";

test("pickRandomBackground picks by rand", () => {
  const files = ["a.mp4", "b.mp4", "c.mp4"];
  assert.equal(pickRandomBackground(files, () => 0), "a.mp4");
  assert.equal(pickRandomBackground(files, () => 0.99), "c.mp4");
});

function makeDeps(overrides = {}) {
  const calls = { status: [], rendered: [], errors: [], downloaded: [] };
  let savedState = {};
  const deps = {
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2 },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: "" },
        { rowIndex: 3, url: "u2", status: "" },
        { rowIndex: 4, url: "u3", status: "" },
        { rowIndex: 5, url: "u4", status: "done" },
      ],
      setUrlStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status }),
    },
    downloader: async (url) => { calls.downloaded.push(url); return { filePath: `/ov/${url}.mp4`, title: url }; },
    renderer: async ({ outputPath }) => { calls.rendered.push(outputPath); return { outputPath }; },
    listBackgrounds: () => ["bg1.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out" }),
    stateStore: { load: () => savedState, save: (s) => { savedState = JSON.parse(JSON.stringify(s)); } },
    emit: (e) => { if (e.type === "error") calls.errors.push(e); },
    now: () => new Date(2026, 6, 7, 10, 0),
    pLimitFn: () => (fn) => fn(),
    rand: () => 0,
    unlink: () => {},
  };
  return { deps: { ...deps, ...overrides }, calls, getState: () => savedState };
}

test("runNow respects videosPerDay quota (2 of 3 pending)", async () => {
  const { deps, calls, getState } = makeDeps();
  const runner = createSheetRunner(deps);
  await runner.runNow();
  assert.equal(calls.downloaded.length, 2);
  assert.equal(calls.rendered.length, 2);
  assert.deepEqual(calls.status.map((s) => s.status), ["done", "done"]);
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
  assert.equal(calls.status.filter((s) => s.status.startsWith("error:")).length, 2);
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
