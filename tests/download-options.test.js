// Module dựng options yt-dlp DÙNG CHUNG cho tải thủ công (download.js) và tải theo
// Sheet (sheet/channel-download.js). Test ở đây ghim đúng các giá trị mà luồng thủ
// công đang chạy được, để bên Sheet không thể trôi khác đi.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DOWNLOAD_FORMAT,
  buildOutputTemplate,
  buildYtdlOptions,
  getBgutilPaths,
  getDriveFilenameLimit,
  getNodeExecutable,
  jsRuntimeArg,
  loadDownloadConfig,
  resolveBinDir,
} from "../sheet/download-options.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dlopt-"));
}

// --- js-runtime -------------------------------------------------------------
// yt-dlp nhận RUNTIME[:PATH]. Truyền đường dẫn trần thì nó đọc "D:\..." thành tên
// runtime "d" -> "Ignoring unsupported JavaScript runtime(s): d" -> JS runtimes: none,
// tức là mất hẳn JS runtime ở bản đóng gói mà không có lỗi nào rõ ràng.
test("jsRuntimeArg gắn tiền tố node: vào đường dẫn tuyệt đối", () => {
  assert.equal(jsRuntimeArg("D:\\app\\bin\\node.exe"), "node:D:\\app\\bin\\node.exe");
});

test("jsRuntimeArg giữ nguyên tên runtime trần", () => {
  assert.equal(jsRuntimeArg("node"), "node");
});

test("jsRuntimeArg không nhân đôi tiền tố khi đã có node:", () => {
  assert.equal(jsRuntimeArg("node:C:\\bin\\node.exe"), "node:C:\\bin\\node.exe");
});

// --- node executable --------------------------------------------------------
test("getNodeExecutable dùng node hệ thống khi chạy dev (không đóng gói)", () => {
  const dir = tmpDir();
  assert.equal(getNodeExecutable(dir), "node");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("getNodeExecutable tìm bin/node.exe kèm theo khi chạy bản đóng gói", () => {
  const root = tmpDir();
  const unpacked = path.join(root, "resources", "app.asar.unpacked");
  fs.mkdirSync(path.join(unpacked, "bin"), { recursive: true });
  const nodeExe = path.join(unpacked, "bin", "node.exe");
  fs.writeFileSync(nodeExe, "");
  assert.equal(getNodeExecutable(unpacked), nodeExe);
  fs.rmSync(root, { recursive: true, force: true });
});

test("getNodeExecutable lùi lên thư mục cha để tìm bin/node.exe", () => {
  const root = tmpDir();
  const unpacked = path.join(root, "resources", "app.asar.unpacked");
  const sub = path.join(unpacked, "sheet");
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(unpacked, "bin"), { recursive: true });
  const nodeExe = path.join(unpacked, "bin", "node.exe");
  fs.writeFileSync(nodeExe, "");
  assert.equal(getNodeExecutable(sub), nodeExe);
  fs.rmSync(root, { recursive: true, force: true });
});

test("getNodeExecutable quay về node khi bản đóng gói thiếu bin/node.exe", () => {
  const root = tmpDir();
  const unpacked = path.join(root, "resources", "app.asar.unpacked");
  fs.mkdirSync(unpacked, { recursive: true });
  assert.equal(getNodeExecutable(unpacked), "node");
  fs.rmSync(root, { recursive: true, force: true });
});

// --- đọc config từ project JSON --------------------------------------------
test("loadDownloadConfig đọc settings.download của project", () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, "kenh-a.json"),
    JSON.stringify({
      settings: {
        download: {
          cookiesFile: "C:\\ck.txt",
          downloadDrive: true,
          driveLanguage: "kr",
          descFolder: "C:\\desc",
          proxy: "1.2.3.4:8080",
        },
      },
    }),
  );
  const cfg = loadDownloadConfig(dir, "kenh-a");
  assert.equal(cfg.cookiesFile, "C:\\ck.txt");
  assert.equal(cfg.downloadDrive, true);
  assert.equal(cfg.driveLanguage, "kr");
  assert.equal(cfg.descFolder, "C:\\desc");
  assert.equal(cfg.proxy, "1.2.3.4:8080");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadDownloadConfig trả mặc định khi thiếu file project", () => {
  const dir = tmpDir();
  const cfg = loadDownloadConfig(dir, "khong-co");
  assert.equal(cfg.cookiesFile, null);
  assert.equal(cfg.downloadDrive, false);
  assert.equal(cfg.driveLanguage, "jp");
  assert.equal(cfg.proxy, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadDownloadConfig không chết vì project JSON hỏng", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "hong.json"), "{ đây không phải JSON");
  const cfg = loadDownloadConfig(dir, "hong");
  assert.equal(cfg.cookiesFile, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadDownloadConfig coi proxy rỗng hoặc chuỗi 'null' là không có proxy", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "p.json"), JSON.stringify({ settings: { download: { proxy: "  " } } }));
  assert.equal(loadDownloadConfig(dir, "p").proxy, null);
  fs.writeFileSync(path.join(dir, "q.json"), JSON.stringify({ settings: { download: { proxy: "null" } } }));
  assert.equal(loadDownloadConfig(dir, "q").proxy, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- tên file khi bật Drive -------------------------------------------------
test("getDriveFilenameLimit theo ngôn ngữ, ngôn ngữ lạ dùng mặc định", () => {
  assert.equal(getDriveFilenameLimit("jp"), 240);
  assert.equal(getDriveFilenameLimit("vi"), 255);
  assert.equal(getDriveFilenameLimit("tiếng gì đó"), 240);
});

test("buildOutputTemplate giới hạn byte tên file khi bật Drive", () => {
  const t = buildOutputTemplate("C:\\out", { downloadDrive: true, driveLanguage: "vi" });
  assert.equal(t, path.join("C:\\out", "%(title).255B.%(ext)s"));
});

test("buildOutputTemplate giữ tên đầy đủ khi tắt Drive", () => {
  const t = buildOutputTemplate("C:\\out", { downloadDrive: false });
  assert.equal(t, path.join("C:\\out", "%(title)s.%(ext)s"));
});

// --- options yt-dlp ---------------------------------------------------------
test("buildYtdlOptions dựng đúng bộ cờ mà luồng tải thủ công đang dùng", () => {
  const o = buildYtdlOptions({ outputDir: "C:\\out" });
  assert.equal(o.format, DOWNLOAD_FORMAT);
  assert.equal(o.mergeOutputFormat, "mp4");
  assert.equal(o.writeThumbnail, true);
  assert.equal(o.convertThumbnails, "jpg");
  assert.equal(o.noOverwrites, true);
  assert.equal(o.limitRate, "2M");
  assert.deepEqual(o.addHeader, [
    "referer:youtube.com",
    "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  ]);
});

test("DOWNLOAD_FORMAT nhận tới 1080p và có nhánh dự phòng khi thiếu độ phân giải", () => {
  assert.ok(DOWNLOAD_FORMAT.includes("height<=1080"));
  assert.ok(DOWNLOAD_FORMAT.split("/").length >= 4, "phải có chuỗi fallback, không khoá cứng một mức");
});

test("buildYtdlOptions truyền js-runtime dạng yt-dlp hiểu được", () => {
  const o = buildYtdlOptions({ outputDir: "C:\\out", jsRuntime: "D:\\app\\bin\\node.exe" });
  assert.equal(o.jsRuntime, "node:D:\\app\\bin\\node.exe");
});

test("buildYtdlOptions bỏ hẳn js-runtime khi không truyền", () => {
  const o = buildYtdlOptions({ outputDir: "C:\\out" });
  assert.equal("jsRuntime" in o, false);
});

test("buildYtdlOptions chỉ gắn cookies khi file có thật", () => {
  const dir = tmpDir();
  const ck = path.join(dir, "cookies.txt");
  fs.writeFileSync(ck, "# Netscape HTTP Cookie File");
  assert.equal(buildYtdlOptions({ outputDir: dir, cookiesFile: ck }).cookies, ck);
  assert.equal("cookies" in buildYtdlOptions({ outputDir: dir, cookiesFile: path.join(dir, "khong-co.txt") }), false);
  assert.equal("cookies" in buildYtdlOptions({ outputDir: dir }), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("buildYtdlOptions truyền extractor-args đã tách dòng", () => {
  const o = buildYtdlOptions({ outputDir: "C:\\out", extractorArgs: "youtube:player_client=tv" });
  assert.deepEqual(o.extractorArgs, ["youtube:player_client=tv"]);
});

test("buildYtdlOptions cấu hình extractor-args rỗng -> không truyền cờ", () => {
  const o = buildYtdlOptions({ outputDir: "C:\\out", extractorArgs: "" });
  assert.equal("extractorArgs" in o, false);
});

test("buildYtdlOptions chỉ ghi mô tả khi thư mục desc có thật", () => {
  const dir = tmpDir();
  assert.equal(buildYtdlOptions({ outputDir: dir, descDir: dir }).writeDescription, true);
  assert.equal("writeDescription" in buildYtdlOptions({ outputDir: dir, descDir: path.join(dir, "nope") }), false);
  assert.equal("writeDescription" in buildYtdlOptions({ outputDir: dir }), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("buildYtdlOptions chỉ gắn proxy khi được truyền", () => {
  assert.equal(buildYtdlOptions({ outputDir: "C:\\out", proxyUrl: "http://1.2.3.4:8080" }).proxy, "http://1.2.3.4:8080");
  assert.equal("proxy" in buildYtdlOptions({ outputDir: "C:\\out" }), false);
});

// --- PO token (bgutil) ------------------------------------------------------
// Thiếu --plugin-dirs thì yt-dlp báo "PO Token Providers: none" và YouTube âm thầm
// chỉ trả về format rác (đo được: 360p thay vì 2160p), không có lỗi nào rõ ràng.
test("buildYtdlOptions truyền plugin-dirs khi được chỉ đường", () => {
  const o = buildYtdlOptions({ outputDir: "C:\out", pluginDirs: "D:\bin\bgutil\plugins" });
  assert.equal(o.pluginDirs, "D:\bin\bgutil\plugins");
  assert.equal("pluginDirs" in buildYtdlOptions({ outputDir: "C:\out" }), false);
});

// Truyền base_url cả khi đúng cổng mặc định: plugin chỉ tự đoán 4416, mà pot-provider
// có thể đã phải nhảy sang 4417/4418 vì cổng bận.
test("buildYtdlOptions gắn base_url của server PO token vào extractor-args", () => {
  const o = buildYtdlOptions({ outputDir: "C:\out", potBaseUrl: "http://127.0.0.1:4417" });
  assert.deepEqual(o.extractorArgs, ["youtubepot-bgutilhttp:base_url=http://127.0.0.1:4417"]);
});

test("buildYtdlOptions gắn script_path làm đường lùi khi server không chạy", () => {
  const o = buildYtdlOptions({ outputDir: "C:\out", potScriptPath: "D:\bin\bgutil\server\build\generate_once.js" });
  assert.deepEqual(o.extractorArgs, [
    "youtubepot-bgutilscript:script_path=D:\bin\bgutil\server\build\generate_once.js",
  ]);
});

// Cờ PO token phải CỘNG THÊM vào cấu hình người dùng gõ, không được đè mất.
test("buildYtdlOptions giữ extractor-args của người dùng khi thêm cờ PO token", () => {
  const o = buildYtdlOptions({
    outputDir: "C:\out",
    extractorArgs: "youtube:player_client=tv",
    potBaseUrl: "http://127.0.0.1:4416",
    potScriptPath: "D:\s\generate_once.js",
  });
  assert.deepEqual(o.extractorArgs, [
    "youtube:player_client=tv",
    "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416",
    "youtubepot-bgutilscript:script_path=D:\s\generate_once.js",
  ]);
});

// --- dò thư mục bgutil ------------------------------------------------------
test("resolveBinDir tìm bin/ ở thư mục hiện tại rồi mới lên cấp trên", () => {
  const root = tmpDir();
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  assert.equal(resolveBinDir(root), path.normalize(bin));
  // Từ thư mục con vẫn phải tìm ra bin/ của cấp trên (bản đóng gói nằm sâu hơn).
  const sub = path.join(root, "resources", "app.asar.unpacked");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(resolveBinDir(sub), path.normalize(bin));
  assert.equal(resolveBinDir(""), null);
  fs.rmSync(root, { recursive: true, force: true });
});

// Chưa chép bgutil sang thì trả null hết -> tải không cờ PO token, chậm và dễ dính
// bot-check, nhưng vẫn chạy. Ném lỗi ở đây là chặn cả app không cho tải gì.
test("getBgutilPaths trả null khi chưa chép bgutil sang bin/", () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, "bin"));
  assert.deepEqual(getBgutilPaths(root), { serverDir: null, pluginDir: null, scriptPath: null });
  fs.rmSync(root, { recursive: true, force: true });
});

// Dựng một cây bgutil tối thiểu nhưng đủ thật: thiếu main.js thì server không chạy
// được, nên hàm dò phải coi thư mục đó là không hợp lệ.
function makeBgutil(root) {
  fs.mkdirSync(path.join(root, "server", "build"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugins", "bgutil-pot"), { recursive: true });
  fs.writeFileSync(path.join(root, "server", "build", "main.js"), "x");
  fs.writeFileSync(path.join(root, "server", "build", "generate_once.js"), "x");
  return root;
}

test("getBgutilPaths tìm đúng server, plugin và script khi chạy dev (bin/bgutil)", () => {
  const root = tmpDir();
  const bg = makeBgutil(path.join(root, "bin", "bgutil"));
  const got = getBgutilPaths(root);
  assert.equal(got.serverDir, path.join(bg, "server"));
  assert.equal(got.pluginDir, path.join(bg, "plugins"));
  assert.equal(got.scriptPath, path.join(bg, "server", "build", "generate_once.js"));
  fs.rmSync(root, { recursive: true, force: true });
});

// Bản đóng gói: electron-builder chèn "!**/node_modules" loại sạch node_modules lồng
// nhau, nên bgutil đi đường extraResources và rơi ở resources/bgutil chứ không phải
// trong bin/. Cả tiến trình Electron lẫn download.js đều có baseDir là
// resources/app.asar.unpacked, nên phải tìm ra qua "../bgutil".
test("getBgutilPaths tìm ra bgutil ở resources/ của bản đóng gói", () => {
  const resources = tmpDir();
  const bg = makeBgutil(path.join(resources, "bgutil"));
  const unpacked = path.join(resources, "app.asar.unpacked");
  fs.mkdirSync(unpacked, { recursive: true });

  const got = getBgutilPaths(unpacked);
  assert.equal(got.serverDir, path.join(bg, "server"));
  assert.equal(got.pluginDir, path.join(bg, "plugins"));
  fs.rmSync(resources, { recursive: true, force: true });
});

// Thiếu main.js = server không khởi động được. Trả null ngay lúc dò còn hơn để yt-dlp
// đâm vào một base_url không có ai nghe rồi báo lỗi mơ hồ lúc đang tải.
test("getBgutilPaths bỏ qua thư mục bgutil cụt (thiếu main.js)", () => {
  const root = tmpDir();
  const bg = path.join(root, "bin", "bgutil");
  fs.mkdirSync(path.join(bg, "server", "build"), { recursive: true });
  fs.mkdirSync(path.join(bg, "plugins"), { recursive: true });
  assert.deepEqual(getBgutilPaths(root), { serverDir: null, pluginDir: null, scriptPath: null });
  fs.rmSync(root, { recursive: true, force: true });
});
