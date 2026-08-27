import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { testRenderChannel, pickClipStart, TEST_CLIP_SECONDS } from "../sheet/test-render-channel.js";

// Nhánh "Test render" của tab Sheet: tải 1 video, cắt ngắn, render thử để XEM,
// KHÔNG upload và KHÔNG để lại dấu vết nào trong Sheet / state / resume.
// makeDeps dựng bộ phụ thuộc giả có ghi lại mọi lời gọi để khẳng định điều đó.
function makeDeps(overrides = {}) {
  const calls = {
    downloaded: [], copied: [], cut: [], rendered: [], opened: [], unlinked: [],
    status: [], uploadStatus: [], emitted: [],
  };
  const deps = {
    config: {
      channelsRoot: "/root", presetsDir: "/presets",
      useGPU: false, gpuVideoCodec: "h264_nvenc", videoSpeed: 0.95,
    },
    sheetsApi: {
      readChannelUrls: async () => [
        { rowIndex: 2, url: "https://youtu.be/first", status: "done", uploadStatus: "✅" },
        { rowIndex: 3, url: "https://youtu.be/second", status: "", uploadStatus: "" },
      ],
      // Có mặt để test khẳng định KHÔNG BAO GIỜ được gọi.
      setUrlStatus: async (n, r, s) => calls.status.push({ n, r, s }),
      setUploadStatus: async (n, r, s) => calls.uploadStatus.push({ n, r, s }),
    },
    downloader: async (url, dir) => {
      calls.downloaded.push({ url, dir });
      return { filePath: path.join(dir, "tai-ve.mp4"), title: "tai-ve" };
    },
    copyLocalOverlay: (name, inputsDir, destDir) => {
      calls.copied.push({ name, inputsDir, destDir });
      return { filePath: path.join(destDir, name), title: name.replace(/\.[^.]+$/, "") };
    },
    listLocalInputs: () => [],
    cutClip: async (o) => { calls.cut.push(o); },
    renderer: async (o) => { calls.rendered.push(o); return { outputPath: o.outputPath }; },
    openFile: (p) => calls.opened.push(p),
    listBackgrounds: () => ["bg1.mp4"],
    pickBackground: (files) => files[0],
    ensureDirs: (root) => ({
      backgroundsDir: path.join(root, "backgrounds"),
      overlaysDir: path.join(root, "overlays"),
      outputDir: path.join(root, "output"),
      inputsDir: path.join(root, "inputs"),
    }),
    ensureDir: () => {},
    detectChroma: async () => "1A2B3C",
    loadPreset: () => null,
    emit: (e) => calls.emitted.push(e),
    unlink: (p) => calls.unlinked.push(p),
    rand: () => 0,
  };
  return { deps: { ...deps, ...overrides }, calls };
}

// Dựng đường dẫn kỳ vọng bằng path.join: trên Windows path.join trả "\\", so sánh
// chuỗi viết tay kiểu "/root/x" là fail giả (3 test trong sheet-runner.test.js đang
// dính đúng lỗi này).
const P = (...p) => path.join(...p);
const TESTDIR = P("/root", "Kênh A", "test");

// Đọc preset dựng sẵn thật trong presets-builtin/.
const BUILTIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "presets-builtin");
const realPreset = (name) => JSON.parse(fs.readFileSync(path.join(BUILTIN_DIR, `${name}.json`), "utf-8"));

const CH = { sheetName: "Kênh A", renderMode: "topTransparent", cfg: { opacity: 0.7 }, proxy: "" };

test("tải URL ở DÒNG ĐẦU TIÊN của tab kênh, kệ trạng thái cột B/C", async () => {
  const { deps, calls } = makeDeps();
  await testRenderChannel(CH, deps);
  assert.equal(calls.downloaded.length, 1);
  assert.equal(calls.downloaded[0].url, "https://youtu.be/first");
});

test("tải và render vào folder test/ của kênh, không đụng overlays/ hay output/", async () => {
  const { deps, calls } = makeDeps();
  const out = await testRenderChannel(CH, deps);
  assert.equal(calls.downloaded[0].dir, TESTDIR);
  assert.equal(out.outputPath, P(TESTDIR, "tai-ve__test.mp4"));
  assert.equal(calls.rendered[0].outputPath, P(TESTDIR, "tai-ve__test.mp4"));
});

test("cắt đúng 30 giây trước khi render, render nhận file đã cắt", async () => {
  const { deps, calls } = makeDeps();
  await testRenderChannel(CH, deps);
  assert.equal(TEST_CLIP_SECONDS, 30);
  assert.equal(calls.cut.length, 1);
  assert.equal(calls.cut[0].input, P(TESTDIR, "tai-ve.mp4"));
  assert.equal(calls.cut[0].seconds, 30);
  assert.equal(calls.rendered[0].overlayFile, calls.cut[0].output);
});

test("render dùng đúng renderMode, cfg và cờ GPU/tốc độ của kênh", async () => {
  const { deps, calls } = makeDeps({
    config: { channelsRoot: "/root", presetsDir: "/presets", useGPU: true, gpuVideoCodec: "hevc_nvenc", videoSpeed: 0.9 },
  });
  await testRenderChannel(CH, deps);
  const r = calls.rendered[0];
  assert.equal(r.renderMode, "topTransparent");
  assert.equal(r.cfg.opacity, 0.7);
  assert.equal(r.cfg.videoSpeed, 0.9);
  assert.equal(r.useGPU, true);
  assert.equal(r.gpuVideoCodec, "hevc_nvenc");
  assert.equal(r.backgroundFile, P("/root", "Kênh A", "backgrounds", "bg1.mp4"));
});

test("KHÔNG ghi trạng thái vào cột B hay cột C của Sheet", async () => {
  const { deps, calls } = makeDeps();
  await testRenderChannel(CH, deps);
  assert.deepEqual(calls.status, []);
  assert.deepEqual(calls.uploadStatus, []);
});

test("dọn file tải và file cắt, chỉ giữ lại bản render", async () => {
  const { deps, calls } = makeDeps();
  const out = await testRenderChannel(CH, deps);
  assert.ok(calls.unlinked.includes(P(TESTDIR, "tai-ve.mp4")), "phải xoá file tải");
  assert.ok(calls.unlinked.includes(calls.cut[0].output), "phải xoá file cắt");
  assert.ok(!calls.unlinked.includes(out.outputPath), "không được xoá bản render");
});

test("mở bản render bằng player mặc định sau khi xong", async () => {
  const { deps, calls } = makeDeps();
  const out = await testRenderChannel(CH, deps);
  assert.deepEqual(calls.opened, [out.outputPath]);
});

test("kênh local: lấy file .mp4 đầu tiên trong inputs/, không tải mạng", async () => {
  const { deps, calls } = makeDeps({ listLocalInputs: () => ["a.mp4", "b.mp4"] });
  await testRenderChannel({ ...CH, videoSource: "local" }, deps);
  assert.deepEqual(calls.downloaded, []);
  assert.equal(calls.copied.length, 1);
  assert.equal(calls.copied[0].name, "a.mp4");
  assert.equal(calls.copied[0].destDir, TESTDIR);
});

// ===== Chặn lỗi TRƯỚC khi tốn một lượt tải =====
// Mỗi lượt yt-dlp tốn băng thông proxy và một lần chạm rate-limit của YouTube. Lỗi nào
// biết được từ cấu hình thì phải ném trước khi tải, không phải sau.

test("kênh chưa có background: lỗi rõ ràng, KHÔNG tải gì", async () => {
  const { deps, calls } = makeDeps({ listBackgrounds: () => [] });
  await assert.rejects(() => testRenderChannel(CH, deps), /background/i);
  assert.deepEqual(calls.downloaded, []);
});

test("composer: preset không đọc được -> lỗi TRƯỚC khi tải", async () => {
  const { deps, calls } = makeDeps({ loadPreset: () => null });
  await assert.rejects(
    () => testRenderChannel({ ...CH, renderMode: "composer", presetName: "sai" }, deps),
    /không đọc được preset "sai"/,
  );
  assert.deepEqual(calls.downloaded, []);
});

test("composer: preset đọc được nhưng không hợp lệ -> lỗi TRƯỚC khi tải", async () => {
  // Preset rỗng lớp: validatePreset thật sẽ từ chối.
  const { deps, calls } = makeDeps({ loadPreset: () => ({ name: "p", canvas: { width: 1280, height: 720 }, layers: [] }) });
  await assert.rejects(
    () => testRenderChannel({ ...CH, renderMode: "composer", presetName: "p" }, deps),
    /không hợp lệ/,
  );
  assert.deepEqual(calls.downloaded, []);
});

test("composer hợp lệ: preset đi vào cfg.preset của renderer", async () => {
  // Preset THẬT trên đĩa, không phải hình dạng bịa: validatePreset trong đường chạy là
  // hàm thật, preset giả sai cấu trúc chỉ chứng minh được validate hoạt động, không
  // chứng minh được nhánh composer chạy tới nơi.
  const { deps, calls } = makeDeps({ loadPreset: () => realPreset("topTransparent") });
  await testRenderChannel({ ...CH, renderMode: "composer", presetName: "topTransparent" }, deps);
  assert.ok(calls.rendered[0].cfg.preset, "renderer phải nhận preset đã nạp");
  assert.equal(calls.rendered[0].cfg.preset.name, "topTransparent");
});

test("composer: slotOverrides của kênh ghi đè đường dẫn asset trong preset", async () => {
  const { deps, calls } = makeDeps({ loadPreset: () => realPreset("blurFrame") });
  await testRenderChannel(
    { ...CH, renderMode: "composer", presetName: "blurFrame", slotOverrides: { khung: "D:/khung-rieng.png" } },
    deps,
  );
  const frame = calls.rendered[0].cfg.preset.layers.find((l) => l.slot === "khung");
  assert.equal(frame.source.path, "D:/khung-rieng.png");
});

test("tab kênh chưa có URL nào: lỗi rõ ràng thay vì vỡ ở chỗ khác", async () => {
  const { deps } = makeDeps({
    sheetsApi: { readChannelUrls: async () => [], setUrlStatus: async () => {}, setUploadStatus: async () => {} },
  });
  // Regex bám đúng câu báo lỗi mong muốn: /URL/i lỏng lẻo cũng khớp cả
  // TypeError "Cannot read properties of undefined (reading 'url')" -> pass giả.
  await assert.rejects(() => testRenderChannel(CH, deps), /chưa có URL nào/);
});

test("kênh local chưa có file trong inputs/: lỗi rõ ràng", async () => {
  const { deps, calls } = makeDeps({ listLocalInputs: () => [] });
  await assert.rejects(() => testRenderChannel({ ...CH, videoSource: "local" }, deps), /Chưa có file .mp4 nào/);
  assert.deepEqual(calls.copied, []);
});

// ===== Proxy =====
// Cùng lý lẽ với runChannel: proxy hỏng thì dừng, không bao giờ tải bằng IP thật.

test("proxy hỏng: ném lỗi và KHÔNG tải", async () => {
  const { deps, calls } = makeDeps();
  await assert.rejects(() => testRenderChannel({ ...CH, proxy: "socks5://bad" }, deps));
  assert.deepEqual(calls.downloaded, []);
});

test("proxy thiếu scheme được chuẩn hoá rồi truyền xuống downloader", async () => {
  const passed = [];
  const { deps } = makeDeps({
    downloader: async (url, dir, opts) => {
      passed.push(opts.proxy);
      return { filePath: path.join(dir, "tai-ve.mp4"), title: "tai-ve" };
    },
  });
  await testRenderChannel({ ...CH, proxy: "1.2.3.4:8080:user:pass" }, deps);
  assert.equal(passed[0], "http://user:pass@1.2.3.4:8080");
});

test("kênh local bỏ qua proxy hoàn toàn (proxy hỏng vẫn chạy)", async () => {
  const { deps, calls } = makeDeps({ listLocalInputs: () => ["a.mp4"] });
  await testRenderChannel({ ...CH, videoSource: "local", proxy: "socks5://bad" }, deps);
  assert.equal(calls.copied.length, 1);
});

// ===== chromaKeyAuto =====

test("chromaKeyAuto: dò màu trên FILE ĐÃ CẮT rồi đưa vào cfg.chromaColor", async () => {
  const seen = [];
  const { deps, calls } = makeDeps({
    detectChroma: async (file) => { seen.push(file); return "1A2B3C"; },
  });
  await testRenderChannel({ ...CH, renderMode: "chromaKeyAuto", chromaPalette: ["00FF00"] }, deps);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], calls.cut[0].output, "dò trên bản 30s, không dò trên video gốc dài");
  assert.equal(calls.rendered[0].cfg.chromaColor, "1A2B3C");
});

test("chromaKeyAuto: dò màu hỏng vẫn render tiếp bằng chromaColor cố định", async () => {
  const { deps, calls } = makeDeps({ detectChroma: async () => { throw new Error("sharp chết"); } });
  await testRenderChannel(
    { ...CH, renderMode: "chromaKeyAuto", chromaPalette: ["00FF00"], cfg: { chromaColor: "D4F9D7" } },
    deps,
  );
  assert.equal(calls.rendered.length, 1);
  assert.equal(calls.rendered[0].cfg.chromaColor, "D4F9D7");
});

test("không có palette: không gọi detectChroma", async () => {
  let called = 0;
  const { deps } = makeDeps({ detectChroma: async () => { called++; return "x"; } });
  await testRenderChannel({ ...CH, renderMode: "chromaKeyAuto" }, deps);
  assert.equal(called, 0);
});

// ===== pickClipStart: cắt ở đâu trong video =====
// Cắt từ giây 0 là dính intro/logo/chào hỏi — đúng đoạn không đại diện cho phần thân
// video mà người dùng đang muốn xem overlay đè lên.

test("pickClipStart: lấy đoạn giữa video", () => {
  assert.equal(pickClipStart(130, 30), 50); // (130-30)/2
});

test("pickClipStart: video ngắn hơn đoạn cần cắt -> bắt đầu từ 0", () => {
  assert.equal(pickClipStart(10, 30), 0);
  assert.equal(pickClipStart(30, 30), 0);
});

test("pickClipStart: thời lượng không đọc được -> 0, không trả NaN", () => {
  assert.equal(pickClipStart(undefined, 30), 0);
  assert.equal(pickClipStart(NaN, 30), 0);
  assert.equal(pickClipStart(0, 30), 0);
});
