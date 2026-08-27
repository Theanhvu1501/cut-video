// Nhánh "Test render" của tab Theo dõi Sheet: tải 1 video của kênh, cắt ngắn, render
// bằng đúng cấu hình kênh đó rồi mở lên xem. Mục đích DUY NHẤT là nhìn thấy video ra
// trông thế nào trước khi cho chạy thật.
//
// KHÔNG dùng chung đường với runChannel() trong sheet-runner.js: hàm đó gánh cả resume,
// quota mỗi ngày, cột trạng thái và hàng đợi upload — nhánh test không cần thứ nào trong
// số đó, rắc if (isTest) vào giữa chỉ làm hỏng chỗ đang chạy ổn.
//
// HỢP ĐỒNG QUAN TRỌNG NHẤT: nhánh này KHÔNG để lại dấu vết.
// Không ghi cột B/C, không đụng runner-state (quota) hay resume-state, không enqueue
// upload, không xoá/đè file trong overlays/ và output/ của kênh. Mọi thứ nằm gọn trong
// <folder kênh>/test/. Nhờ vậy bấm test bao nhiêu lần cũng không làm lệch lượt chạy thật.

import path from "path";
import { normalizeProxy } from "./proxy.js";
import { applySlotOverrides } from "./preset-store.js";
import { validatePreset } from "./layer-compiler.js";

// Cắt bao nhiêu giây để render thử. Đủ dài để thấy overlay/chroma/nhạc ăn khớp,
// đủ ngắn để không phải chờ.
export const TEST_CLIP_SECONDS = 30;

// Cắt ở ĐOẠN GIỮA chứ không từ giây 0: đầu video hay là intro/logo/lời chào, đúng đoạn
// không đại diện cho phần thân — thứ người dùng cần nhìn để đánh giá bố cục render.
// Thời lượng không đọc được (ffprobe hỏng, file lạ) thì cắt từ đầu, không trả NaN xuống
// cho ffmpeg vì "-ss NaN" là lỗi tham số khó hiểu hơn nhiều so với một clip lệch chỗ.
export function pickClipStart(totalSeconds, clipSeconds) {
  const total = Number(totalSeconds);
  if (!Number.isFinite(total) || total <= clipSeconds) return 0;
  return (total - clipSeconds) / 2;
}

// Hậu tố tách bạch bản test với video thật: cùng nằm trong test/ nhưng nhìn tên là biết.
const TEST_SUFFIX = "__test";
const CUT_SUFFIX = "__cut";

export async function testRenderChannel(ch, deps) {
  const {
    config, sheetsApi, downloader, copyLocalOverlay, listLocalInputs, cutClip, renderer,
    openFile, listBackgrounds, pickBackground, ensureDirs, ensureDir, detectChroma, loadPreset, emit, unlink, rand,
  } = deps;

  const isLocal = ch.videoSource === "local";
  const channelRoot = path.join(config.channelsRoot, ch.sheetName);
  const { backgroundsDir, inputsDir } = ensureDirs(channelRoot);
  const testDir = path.join(channelRoot, "test");
  ensureDir(testDir);

  const backgrounds = listBackgrounds(backgroundsDir);
  if (!backgrounds.length) throw new Error("Chưa có background (.mp4) trong folder kênh.");

  // Proxy hỏng -> dừng, KHÔNG tải bằng IP thật. Cùng lý lẽ với runChannel: người dùng
  // dựa vào proxy để né bot-check, lộ IP thật là kết cục tệ nhất.
  let proxy = "";
  if (!isLocal && String(ch.proxy ?? "").trim()) proxy = normalizeProxy(ch.proxy);

  // Kiểm preset TRƯỚC khi tải: preset gõ sai thì hỏng ngay từ đây, không tốn lượt yt-dlp
  // nào — đúng thứ tự mà runChannel đã chọn sau review I1a.
  let preset = null;
  if (ch.renderMode === "composer") {
    preset = loadPreset(config.presetsDir, ch.presetName);
    if (!preset) throw new Error(`không đọc được preset "${ch.presetName || "(trống)"}"`);
    const check = validatePreset(preset);
    if (!check.ok) throw new Error(`preset "${ch.presetName || "(trống)"}" không hợp lệ: ${check.errors.join("; ")}`);
  }

  // Nguồn video: kênh local lấy file đầu trong inputs/, kênh mạng lấy DÒNG ĐẦU cột A.
  // Cố ý kệ trạng thái cột B/C — kênh đã chạy xong hết vẫn phải test được.
  let dl;
  if (isLocal) {
    const files = listLocalInputs(inputsDir);
    if (!files.length) throw new Error("Chưa có file .mp4 nào trong folder inputs/ của kênh.");
    emit({ type: "channel-status", channel: ch.sheetName, status: "test: đang lấy file", url: files[0] });
    dl = copyLocalOverlay(files[0], inputsDir, testDir);
  } else {
    const urls = await sheetsApi.readChannelUrls(ch.sheetName);
    if (!urls.length) throw new Error("Tab kênh chưa có URL nào ở cột A.");
    const first = urls[0];
    emit({ type: "channel-status", channel: ch.sheetName, status: "test: đang tải", url: first.url });
    dl = await downloader(first.url, testDir, { proxy });
  }

  const cutPath = path.join(testDir, `${dl.title}${CUT_SUFFIX}.mp4`);
  emit({ type: "channel-status", channel: ch.sheetName, status: `test: đang cắt ${TEST_CLIP_SECONDS}s` });
  await cutClip({ input: dl.filePath, output: cutPath, seconds: TEST_CLIP_SECONDS });

  const cfg = { ...ch.cfg };
  if (config.videoSpeed != null) cfg.videoSpeed = config.videoSpeed;
  if (ch.renderMode === "chromaKeyAuto" && ch.chromaPalette?.length) {
    try {
      // Dò trên BẢN ĐÃ CẮT chứ không phải video gốc: bản gốc dài chục phút, dò tốn thời
      // gian vô ích, mà màu phông cần dò lại đúng là màu của đoạn sắp render.
      cfg.chromaColor = await detectChroma(cutPath, ch.chromaPalette);
    } catch (err) {
      emit({ type: "log", message: `[${ch.sheetName}] test: dò màu thất bại, dùng chromaColor cố định: ${String(err?.message || err).slice(0, 120)}` });
    }
  }
  if (preset) cfg.preset = applySlotOverrides(preset, ch.slotOverrides);

  const outputPath = path.join(testDir, `${dl.title}${TEST_SUFFIX}.mp4`);
  emit({ type: "channel-status", channel: ch.sheetName, status: "test: đang render" });
  await renderer({
    overlayFile: cutPath,
    backgroundFile: path.join(backgroundsDir, pickBackground(backgrounds, rand)),
    outputPath,
    renderMode: ch.renderMode,
    cfg,
    useGPU: config.useGPU,
    gpuVideoCodec: config.gpuVideoCodec,
    // Chỉ lấy cảnh báo (quy ước "⚠️" xuyên codebase), bỏ mọi dòng stderr khác của ffmpeg.
    onProgress: (m) => {
      if (String(m).startsWith("⚠️")) emit({ type: "log", message: `[${ch.sheetName}] ${m}` });
    },
  });

  // Dọn bản tải và bản cắt, giữ đúng một file để xem. Không đụng gì ngoài test/.
  for (const f of [dl.filePath, thumbOf(dl.filePath), cutPath]) {
    try { unlink(f); } catch { /* ignore */ }
  }

  emit({ type: "log", message: `[${ch.sheetName}] ✅ test render xong: ${outputPath}` });
  openFile(outputPath);
  return { outputPath, title: dl.title };
}

// yt-dlp lưu thumb cùng basename với video: <title>.mp4 -> <title>.jpg
function thumbOf(videoPath) {
  return String(videoPath).replace(/\.[^.]+$/, ".jpg");
}
