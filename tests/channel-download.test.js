import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickDownloadedFile, downloadOne, copyLocalOverlay } from "../sheet/channel-download.js";
import { DEFAULT_EXTRACTOR_ARGS } from "../sheet/ytdlp-config.js";
import { DOWNLOAD_FORMAT } from "../sheet/download-options.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
}

// ytdl giả: ghi ra đúng file mp4 mà downloadOne mong đợi, và ghi lại options.
function fakeYtdlFactory(seen) {
  return () => async (url, options) => {
    seen.push(options);
    const dir = path.dirname(options.output);
    fs.writeFileSync(path.join(dir, "Tiêu đề.mp4"), "x");
  };
}

test("pickDownloadedFile chỉ nhận mp4 mới xuất hiện", () => {
  assert.equal(pickDownloadedFile(["a.mp4"], ["a.mp4", "b.mp4", "b.jpg"]), "b.mp4");
  assert.equal(pickDownloadedFile(["a.mp4"], ["a.mp4"]), null);
});

test("downloadOne chuẩn hoá proxy thiếu scheme trước khi gọi yt-dlp", async () => {
  const dir = tmpDir();
  const seen = [];
  const out = await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, {
    proxy: "1.2.3.4:8080",
    ytdlFactory: fakeYtdlFactory(seen),
  });
  assert.equal(seen[0].proxy, "http://1.2.3.4:8080");
  assert.equal(out.title, "Tiêu đề");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne ném lỗi với proxy hỏng và KHÔNG gọi yt-dlp", async () => {
  const dir = tmpDir();
  const seen = [];
  await assert.rejects(
    () => downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, { proxy: "rác", ytdlFactory: fakeYtdlFactory(seen) }),
    /Proxy không hợp lệ/,
  );
  assert.deepEqual(seen, []); // chưa hề chạm mạng
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne không set proxy khi để trống (cố ý tải thẳng)", async () => {
  const dir = tmpDir();
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, { proxy: "  ", ytdlFactory: fakeYtdlFactory(seen) });
  assert.equal("proxy" in seen[0], false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne dùng extractor-args mặc định khi không truyền gì", async () => {
  const dir = tmpDir();
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, { ytdlFactory: fakeYtdlFactory(seen) });
  assert.deepEqual(seen[0].extractorArgs, [DEFAULT_EXTRACTOR_ARGS]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne truyền extractor-args người dùng cấu hình trong app", async () => {
  const dir = tmpDir();
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, {
    extractorArgs: "youtube:player_client=tv",
    ytdlFactory: fakeYtdlFactory(seen),
  });
  assert.deepEqual(seen[0].extractorArgs, ["youtube:player_client=tv"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne: cấu hình rỗng -> KHÔNG truyền cờ extractor-args", async () => {
  const dir = tmpDir();
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, {
    extractorArgs: "",
    ytdlFactory: fakeYtdlFactory(seen),
  });
  assert.equal("extractorArgs" in seen[0], false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("copyLocalOverlay copies file to overlays and derives title", () => {
  const inputs = tmpDir();
  const overlays = tmpDir();
  fs.writeFileSync(path.join(inputs, "video-a.mp4"), "DATA");
  const r = copyLocalOverlay("video-a.mp4", inputs, overlays);
  assert.equal(r.title, "video-a");
  assert.equal(r.filePath, path.join(overlays, "video-a.mp4"));
  assert.equal(fs.readFileSync(r.filePath, "utf-8"), "DATA");
  fs.rmSync(inputs, { recursive: true, force: true });
  fs.rmSync(overlays, { recursive: true, force: true });
});

test("copyLocalOverlay copies sibling <title>.jpg thumbnail when present", () => {
  const inputs = tmpDir();
  const overlays = tmpDir();
  fs.writeFileSync(path.join(inputs, "clip.mp4"), "V");
  fs.writeFileSync(path.join(inputs, "clip.jpg"), "IMG");
  copyLocalOverlay("clip.mp4", inputs, overlays);
  assert.equal(fs.readFileSync(path.join(overlays, "clip.jpg"), "utf-8"), "IMG");
  fs.rmSync(inputs, { recursive: true, force: true });
  fs.rmSync(overlays, { recursive: true, force: true });
});

test("copyLocalOverlay throws when source file missing", () => {
  const inputs = tmpDir();
  const overlays = tmpDir();
  assert.throws(() => copyLocalOverlay("nope.mp4", inputs, overlays), /nope\.mp4/);
  fs.rmSync(inputs, { recursive: true, force: true });
  fs.rmSync(overlays, { recursive: true, force: true });
});

// --- tải theo Sheet phải giống hệt tải thủ công ------------------------------
// Trước đây bên Sheet khoá cứng height=720, không cookies, không JS runtime nên
// hay trượt trong khi tải thủ công cùng URL lại được.

test("downloadOne dùng đúng bộ cờ của luồng tải thủ công", async () => {
  const dir = tmpDir();
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, { ytdlFactory: fakeYtdlFactory(seen) });
  assert.equal(seen[0].format, DOWNLOAD_FORMAT);
  assert.equal(seen[0].limitRate, "2M");
  assert.equal(seen[0].mergeOutputFormat, "mp4");
  assert.equal(seen[0].writeThumbnail, true);
  assert.equal(seen[0].convertThumbnails, "jpg");
  assert.equal(seen[0].noOverwrites, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne gắn cookies khi file cookies có thật", async () => {
  const dir = tmpDir();
  const ck = path.join(dir, "cookies.txt");
  fs.writeFileSync(ck, "# Netscape HTTP Cookie File");
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, { cookiesFile: ck, ytdlFactory: fakeYtdlFactory(seen) });
  assert.equal(seen[0].cookies, ck);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne vẫn tải khi đường dẫn cookies trỏ vào file không tồn tại", async () => {
  const dir = tmpDir();
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, {
    cookiesFile: path.join(dir, "khong-co.txt"),
    ytdlFactory: fakeYtdlFactory(seen),
  });
  assert.equal("cookies" in seen[0], false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne truyền js-runtime kèm tên runtime để yt-dlp nhận ra node", async () => {
  const dir = tmpDir();
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, {
    jsRuntime: "D:\\app\\bin\\node.exe",
    ytdlFactory: fakeYtdlFactory(seen),
  });
  assert.equal(seen[0].jsRuntime, "node:D:\\app\\bin\\node.exe");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne giới hạn byte tên file khi bật tải Drive", async () => {
  const dir = tmpDir();
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, {
    downloadDrive: true,
    driveLanguage: "jp",
    ytdlFactory: fakeYtdlFactory(seen),
  });
  assert.equal(seen[0].output, path.join(dir, "%(title).240B.%(ext)s"));
  fs.rmSync(dir, { recursive: true, force: true });
});
