import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickDownloadedFile, downloadOne } from "../sheet/channel-download.js";

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
