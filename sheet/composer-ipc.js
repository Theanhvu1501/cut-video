// Giai đoạn 2A — cầu IPC cho tab Composer. File MỚI HOÀN TOÀN theo đúng ràng buộc của giai
// đoạn này: mọi logic mới nằm ở đây, không sửa preset-store.js/layer-compiler.js/render-
// core.js/render.js — chỉ DÙNG LẠI các hàm chúng đã export.
//
// electron-main.js chỉ được thêm 2 dòng cho file này (1 import, 1 lời gọi đăng ký) nên toàn
// bộ 9 kênh composer:* phải tự đăng ký trong registerComposerIpc(), không rải ra electron-
// main.js. dialog không nằm trong { ipcMain, app, BrowserWindow } mà registerComposerIpc
// nhận vào (đúng chữ ký trong kế hoạch), nên import thẳng từ "electron" ở đây.
import { dialog } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { listPresets, loadPreset, savePreset, ensureBuiltins } from "./preset-store.js";
import { validatePreset, compilePreset } from "./layer-compiler.js";
import { resolvePresetAssets, resolveFfmpegPaths, extractFfmpegError } from "./render-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

// Thư mục preset dựng sẵn đi kèm repo (nguồn để ensureBuiltins copy sang thư mục người dùng).
export function getBuiltinPresetsDir() {
  return path.join(REPO_ROOT, "presets-builtin");
}

// Cùng cơ chế với getProjectsDir() trong electron-main.js (bản đóng gói dùng userData ghi
// được; bản dev dùng thẳng thư mục mã nguồn) — xem electron-main.js:722-725. electron-main.js
// không export getConfigDir()/getProjectsDir() (module đó bị khoá "chỉ thêm dòng" ở Giai đoạn
// 2A) nên phải tính lại đúng công thức ở đây thay vì import ngược. Hai công thức PHẢI khớp
// nhau tuyệt đối, nếu không luồng Sheet (đọc config.presetsDir) và tab Composer sẽ đọc/ghi
// preset ở hai thư mục khác nhau.
export function getPresetsDir(app) {
  const configDir = app.isPackaged ? app.getPath("userData") : REPO_ROOT;
  return path.join(configDir, "presets");
}

// preset-store.js không export safeName (module đó bị khoá "chỉ thêm dòng" ở Giai đoạn 2A).
// Xoá preset phải áp ĐÚNG cùng quy tắc làm sạch tên mà savePreset dùng để ghi file — lệch
// quy tắc thì tên "Alpha" xoá nhầm sang đường dẫn khác với "alpha" đã lưu (hay ngược lại, xoá
// "trượt" không trúng file thật). Sao chép y nguyên logic — không phải quên DRY — nếu
// preset-store.js đổi safeName ở giai đoạn sau, bản sao này phải đổi theo tay.
function safeName(name) {
  return String(name || "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "preset";
}

// Chạy ffmpeg một lần (dùng cho previewFrame), gom stderr để dò lỗi bằng extractFfmpegError
// của render-core.js — không viết lại logic đọc lỗi ffmpeg ở đây.
function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve) => {
    let stderr = "";
    let child;
    try {
      child = spawn(ffmpegPath, args);
    } catch (err) {
      resolve({ code: -1, stderr: String(err?.message || err) });
      return;
    }
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => resolve({ code: -1, stderr: String(err?.message || err) }));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

// Giai đoạn 2B — cache khung hình đại diện cho canvas kéo thả: Map<videoPath, dataUri>. CHỈ
// khoá theo videoPath (không kèm giây xem) — canvas không cần xem đúng giây như previewFrame,
// nó chỉ cần MỘT khung "trông giống video này" để không phải vẽ ô xám giả. Không dùng cache
// theo (videoPath, atSecond) để tránh trích lại file mỗi lần người dùng gõ số giây khác — đổi
// lại là hành vi CÓ CHỦ Ý: đổi giây sau lần trích đầu không làm khung đại diện đổi theo.
const thumbCache = new Map();

// Trích 1 khung PNG thật từ video mẫu, trả về data URI (nhúng thẳng vào <img src>, không cần
// phục vụ qua file:// nên không phải lo escape đường dẫn Windows như previewFrame). Dùng ĐÚNG
// resolveFfmpegPaths() của render-core.js — không viết lại logic dò ffmpeg.exe ở đây.
async function extractThumb({ videoPath, atSecond } = {}, app) {
  if (!videoPath) return { ok: false, error: "chưa chọn video mẫu" };
  const cached = thumbCache.get(videoPath);
  if (cached) return { ok: true, dataUri: cached };

  const second = Number(atSecond) >= 0 ? Number(atSecond) : 1;
  const outPath = path.join(
    app.getPath("temp"),
    `composer-thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  );
  // scale=320:-2: khung đại diện chỉ để ĐỊNH VỊ trên canvas thu nhỏ, không cần độ phân giải gốc
  // — giữ data URI nhỏ (nhúng trực tiếp vào DOM, không phải file riêng nên không giới hạn bởi
  // đường truyền, nhưng vẫn nên nhỏ vì mỗi lần đổi preset có thể vẽ lại nhiều khung cùng lúc).
  const args = [
    "-y", "-ss", String(second), "-i", videoPath,
    "-frames:v", "1", "-vf", "scale=320:-2",
    outPath,
  ];
  const { ffmpegPath } = resolveFfmpegPaths();
  const { code, stderr } = await runFfmpeg(ffmpegPath, args);
  if (code !== 0) {
    const detail = extractFfmpegError(stderr);
    return { ok: false, error: detail || `ffmpeg thoát với mã ${code}` };
  }
  let buf;
  try {
    buf = fs.readFileSync(outPath);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    // Đã đọc xong vào buffer — dọn file tạm ngay, không cần chờ (lỗi xoá không quan trọng,
    // đây chỉ là file trong thư mục temp của OS).
    fs.unlink(outPath, () => {});
  }
  const dataUri = `data:image/png;base64,${buf.toString("base64")}`;
  thumbCache.set(videoPath, dataUri);
  return { ok: true, dataUri };
}

// Xuất 1 khung hình PNG thật bằng ĐÚNG resolvePresetAssets + compilePreset của luồng render
// thật (sheet/render-core.js, sheet/layer-compiler.js) — không dựng graph riêng, nếu không
// bản xem trước sẽ "nói dối" so với video render ra thật.
//
// Hai giới hạn PHẢI hiện ngay trên UI (composer-ui.js), không chỉ nằm trong code:
// 1) Ảnh tĩnh (PNG xuất ra) không thể hiện setpts/atempo (tốc độ videoSpeed, mặc định 0.95)
//    — đó là bước renderOne/render.js chèn SAU khi có [combined_video], previewFrame dừng
//    lại đúng ở [combined_video] nên không đi qua bước đó.
// 2) Waveform vẽ từ audio TẠI GIÂY atSecond đang xem, không phải toàn bộ audio — xem giây
//    khác ra hình sóng khác là ĐÚNG, không phải lỗi.
async function previewFrame({ preset, overlayFile, backgroundFile, atSecond } = {}, app) {
  const check = validatePreset(preset);
  if (!check.ok) return { ok: false, errors: check.errors, warnings: [] };
  if (!overlayFile) return { ok: false, errors: ["chưa chọn video gốc (overlay) để xem thử"], warnings: [] };
  if (!backgroundFile) return { ok: false, errors: ["chưa chọn video nền (background) để xem thử"], warnings: [] };

  const { preset: resolved, warnings: assetWarnings } = resolvePresetAssets(preset);
  const composed = compilePreset(resolved);
  const warnings = [...assetWarnings, ...composed.warnings];

  const second = Number(atSecond) >= 0 ? Number(atSecond) : 0;
  const outPath = path.join(
    app.getPath("temp"),
    `composer-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  );

  // Input [0] = nền, [1] = video gốc — CÙNG hợp đồng chỉ số mà compilePreset giả định (xem
  // FIRST_EXTRA_INPUT trong layer-compiler.js). -ss trên cả hai để khung xuất ra khớp thời
  // điểm atSecond của video gốc; nền vẫn giữ -stream_loop -1 như renderOne thật để không vỡ
  // nếu atSecond vượt quá thời lượng nền.
  const args = [
    "-y",
    "-ss", String(second), "-stream_loop", "-1", "-i", backgroundFile,
    "-ss", String(second), "-i", overlayFile,
  ];
  for (const extra of composed.extraInputs) {
    args.push(...(extra.inputOptions || []), "-i", extra.file);
  }
  args.push(
    "-filter_complex", composed.filterGraph.join(";"),
    "-map", "[combined_video]",
    "-update", "1", // ghi ĐÚNG 1 file ảnh tĩnh (không phải mẫu %03d của chuỗi ảnh) — ffmpeg cảnh báo nếu thiếu cờ này.
    "-frames:v", "1",
    outPath,
    // compilePreset() LUÔN phát thêm một node audio "[overlay_audio]" ở cuối filterGraph (hợp
    // đồng cố định của nó, dùng chung cho cả renderOne — không được đụng, xem layer-compiler.js).
    // Nếu không "-map" nó đi đâu cả thì ffmpeg từ chối THẲNG cả filtergraph với "Error binding
    // filtergraph inputs/outputs: Invalid argument" (mọi output pad có tên trong filter_complex
    // BẮT BUỘC phải được tiêu thụ, kể cả khi không -map là cố ý) — đây là lỗi THẬT bắt được khi
    // tự chạy thử previewFrame, không phải suy đoán. Output thứ hai này chỉ để "tiêu thụ" audio
    // rồi vứt đi (muxer null), ảnh PNG ở trên vẫn hoàn toàn không có audio.
    "-map", "[overlay_audio]",
    "-f", "null", "-"
  );

  const { ffmpegPath } = resolveFfmpegPaths();
  const { code, stderr } = await runFfmpeg(ffmpegPath, args);
  if (code !== 0) {
    const detail = extractFfmpegError(stderr);
    return { ok: false, errors: [detail || `ffmpeg thoát với mã ${code}`], warnings };
  }
  return { ok: true, framePath: outPath, warnings };
}

// render.js đòi backgroundFolder chứa THƯ MỤC CON đặt tên theo số ngày (backgrounds/1/*.mp4),
// không phải file .mp4 nằm trực tiếp trong đó (xem render.js: fs.readdirSync(backgroundFolder)
// rồi lọc isDirectory()). Preset dùng UI kéo thả rất dễ trỏ nhầm vào thư mục chứa thẳng file
// — nếu không bắt ở đây, người dùng chỉ nhận được "❌ Không tìm thấy thư mục background nào!"
// từ render.js, không biết vì sao.
function checkBackgroundStructure(backgroundFolder) {
  let entries;
  try {
    entries = fs.readdirSync(backgroundFolder, { withFileTypes: true });
  } catch (err) {
    return `Không đọc được thư mục background "${backgroundFolder}": ${err.message}`;
  }
  const hasSubdir = entries.some((e) => e.isDirectory());
  if (!hasSubdir) {
    return (
      `Thư mục background "${backgroundFolder}" không có thư mục con nào. render.js cần cấu ` +
      `trúc backgrounds/<số ngày>/*.mp4 (ví dụ backgrounds/1/) — không phải file .mp4 đặt ` +
      `trực tiếp trong thư mục này.`
    );
  }
  return null;
}

// Node.exe + đường dẫn render.js trong bản đóng gói: SAO CHÉP có chủ đích logic
// getAppPath()/nodeExecutable của electron-main.js (electron-main.js:41-60, 1845-1879) — file
// đó bị khoá "chỉ thêm dòng" ở Giai đoạn 2A nên không export lại được các helper private này,
// và composer-ipc.js cần spawn render.js độc lập với luồng "run-script" hiện có (renderer.js
// gọi run-script qua ipcRenderer, composer-ipc.js chạy trong main process nên không gọi lại
// qua đó được). Nếu electron-main.js đổi cách tìm node.exe/app.asar.unpacked ở giai đoạn sau,
// bản sao này phải đổi theo tay.
function resolveNodeExecutable(app) {
  if (!app.isPackaged) return "node";
  const candidates = [
    path.join(process.resourcesPath, "app.asar.unpacked", "bin", "node.exe"),
    path.join(process.resourcesPath, "bin", "node.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "node";
}

function resolveRenderScriptPath(app) {
  if (!app.isPackaged) return path.join(REPO_ROOT, "render.js");
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked");
  return path.join(fs.existsSync(unpacked) ? unpacked : process.resourcesPath, "render.js");
}

// Render thử N video bằng render.js thật, cùng cách electron-main.js spawn các script khác
// (xem electron-main.js:1917 trở đi: RENDER_CONFIG_JSON qua env, stdout/stderr đẩy về renderer
// theo dòng). renderMode: "composer" + preset nhúng thẳng vào RENDER_CONFIG_JSON — render.js
// đã có sẵn nhánh đọc hai trường này (render.js dòng 385-386, 467-495).
async function renderTest(event, opts, app) {
  const {
    preset, overlayFolder, backgroundFolder, outputFolder,
    videos, day, videoSpeed, useGPU,
  } = opts || {};

  const check = validatePreset(preset);
  if (!check.ok) return { ok: false, error: `preset không hợp lệ: ${check.errors.join("; ")}` };
  if (!overlayFolder) return { ok: false, error: "chưa chọn thư mục overlay (video gốc)" };
  if (!backgroundFolder) return { ok: false, error: "chưa chọn thư mục background" };
  const structureError = checkBackgroundStructure(backgroundFolder);
  if (structureError) return { ok: false, error: structureError };

  const scriptPath = resolveRenderScriptPath(app);
  if (!fs.existsSync(scriptPath)) return { ok: false, error: `Không tìm thấy render.js tại: ${scriptPath}` };

  const env = {
    ...process.env,
    RENDER_CONFIG_JSON: JSON.stringify({
      renderMode: "composer", preset,
      overlayFolder, backgroundFolder, outputFolder,
      videoSpeed, useGPU,
    }),
  };

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(resolveNodeExecutable(app), [scriptPath, String(day), String(videos)], {
        cwd: path.dirname(scriptPath),
        stdio: "pipe",
        env,
      });
    } catch (err) {
      resolve({ ok: false, error: String(err?.message || err) });
      return;
    }
    // Kênh log RIÊNG (composer:renderTestLog), không dùng chung "script-output": renderer.js
    // có nhiều chỗ gọi removeScriptOutputListener() (xoá SẠCH mọi listener của kênh đó) trước
    // khi gắn listener riêng của tab đang chạy — dùng chung kênh sẽ khiến log renderTest bị
    // một tab khác xoá mất listener giữa chừng.
    const send = (line) => { if (!event.sender.isDestroyed()) event.sender.send("composer:renderTestLog", line); };
    let stderrLog = "";
    child.stdout.on("data", (d) => send(d.toString()));
    child.stderr.on("data", (d) => { stderrLog += d.toString(); send(d.toString()); });
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderrLog || `render.js thoát với mã ${code}` });
    });
    child.on("error", (err) => resolve({ ok: false, error: String(err?.message || err) }));
  });
}

export function registerComposerIpc({ ipcMain, app, BrowserWindow }) {
  ipcMain.handle("composer:presetsDir", async () => getPresetsDir(app));

  ipcMain.handle("composer:list", async () => {
    const dir = getPresetsDir(app);
    // ensureBuiltins copy 5 preset dựng sẵn sang thư mục người dùng LẦN ĐẦU (không ghi đè bản
    // đã có) — đẩy cả copied lẫn warnings về UI, đừng bỏ warnings như spec đã nhắc.
    const { copied, warnings } = ensureBuiltins(dir, getBuiltinPresetsDir());
    return { names: listPresets(dir), warnings, copied };
  });

  ipcMain.handle("composer:load", async (event, name) => loadPreset(getPresetsDir(app), name));

  ipcMain.handle("composer:save", async (event, preset) => savePreset(getPresetsDir(app), preset));

  ipcMain.handle("composer:delete", async (event, name) => {
    const file = path.join(getPresetsDir(app), `${safeName(name)}.json`);
    try {
      fs.unlinkSync(file);
      return { ok: true };
    } catch (err) {
      // ENOENT (đã xoá rồi/chưa từng tồn tại) không phải lỗi thật với người dùng — coi như xong.
      if (err.code === "ENOENT") return { ok: true };
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("composer:validate", async (event, preset) => validatePreset(preset));

  ipcMain.handle("composer:pickAsset", async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    const properties =
      options.kind === "file" ? ["openFile"]
      : options.kind === "folder" ? ["openDirectory"]
      : ["openFile", "openDirectory"]; // mặc định: cho chọn cả hai, vì source.path của một
                                        // lớp image/video có thể là file lẻ hoặc thư mục bốc
                                        // ngẫu nhiên (xem pickAsset trong render-core.js).
    const result = await dialog.showOpenDialog(win, { properties, filters: options.filters });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("composer:previewFrame", async (event, opts) => previewFrame(opts, app));

  // Giai đoạn 2B — canvas kéo thả: khung hình đại diện thật cho lớp background/overlay/video
  // (không phải ô xám) — xem extractThumb() phía trên.
  ipcMain.handle("composer:extractThumb", async (event, opts) => extractThumb(opts, app));

  ipcMain.handle("composer:renderTest", async (event, opts) => renderTest(event, opts, app));
}
