// Xoay vòng cookie: YouTube gắn cờ "not a bot" lên từng cookie chứ không lên máy,
// nên hết cookie này còn cookie khác. Test ghim ba thứ dễ vỡ nhất: thứ tự phải ổn
// định giữa các lần chạy, thư mục rỗng phải lùi về hành vi cũ (1 file), và chỉ lỗi
// bot-check mới được rotate.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createCookiePool,
  isBotCheckError,
  listCookieFiles,
  resolveSheetCookieSource,
} from "../sheet/cookie-pool.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cookie-"));
}

function withCookies(names) {
  const dir = tmpDir();
  for (const n of names) fs.writeFileSync(path.join(dir, n), "# Netscape HTTP Cookie File\n");
  return dir;
}

// --- liệt kê ----------------------------------------------------------------

test("listCookieFiles chỉ lấy .txt và sắp theo tên", () => {
  const dir = withCookies(["b.txt", "a.txt", "note.md", "c.TXT"]);
  assert.deepEqual(
    listCookieFiles(dir).map((p) => path.basename(p)),
    ["a.txt", "b.txt", "c.TXT"],
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("listCookieFiles trả mảng rỗng khi thư mục không tồn tại", () => {
  assert.deepEqual(listCookieFiles("D:\\khong-he-co-thu-muc-nay"), []);
  assert.deepEqual(listCookieFiles(null), []);
});

// --- pool -------------------------------------------------------------------

test("pool xoay vòng tròn qua các cookie trong thư mục", () => {
  const dir = withCookies(["1.txt", "2.txt", "3.txt"]);
  const pool = createCookiePool({ folder: dir });
  assert.equal(pool.size, 3);
  assert.equal(path.basename(pool.current()), "1.txt");
  pool.rotate();
  assert.equal(path.basename(pool.current()), "2.txt");
  pool.rotate();
  assert.equal(path.basename(pool.current()), "3.txt");
  pool.rotate(); // quay lại đầu
  assert.equal(path.basename(pool.current()), "1.txt");
  fs.rmSync(dir, { recursive: true, force: true });
});

// Thư mục rỗng KHÔNG được nuốt mất file đơn: project cũ chỉ có cookiesFile, mở lên
// phải chạy y như trước chứ không phải tải trần không cookies.
test("thư mục rỗng thì lùi về file đơn", () => {
  const dir = tmpDir();
  const file = path.join(dir, "cookies.txt");
  fs.writeFileSync(file, "x");
  const pool = createCookiePool({ folder: path.join(dir, "rong"), file });
  assert.equal(pool.size, 1);
  assert.equal(pool.current(), file);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("không có gì cả thì current() trả null, không ném lỗi", () => {
  const pool = createCookiePool({});
  assert.equal(pool.size, 0);
  assert.equal(pool.current(), null);
  pool.rotate(); // không được vỡ
  assert.equal(pool.current(), null);
});

// File cookie trỏ vào đường dẫn không tồn tại thì bỏ qua, hơn là để yt-dlp chết vì
// đường dẫn sai — giống cách buildYtdlOptions đang xử lý.
test("file đơn không tồn tại thì coi như không có cookie", () => {
  const pool = createCookiePool({ file: "D:\\khong-co-file-nay.txt" });
  assert.equal(pool.size, 0);
  assert.equal(pool.current(), null);
});

// --- nhận diện bot-check ----------------------------------------------------

test("isBotCheckError nhận đúng các dấu hiệu bị chặn", () => {
  assert.ok(isBotCheckError("ERROR: Sign in to confirm you're not a bot"));
  assert.ok(isBotCheckError("Sign in to confirm you’re not a bot")); // dấu nháy cong
  assert.ok(isBotCheckError("unable to download video data: HTTP Error 403: Forbidden"));
  assert.ok(isBotCheckError("ERROR: Requested format is not available"));
  assert.ok(isBotCheckError(new Error("Sign in to confirm you're not a bot")));
});

test("isBotCheckError bỏ qua lỗi thường", () => {
  assert.equal(isBotCheckError("ERROR: unable to open for writing: No space left"), false);
  assert.equal(isBotCheckError("Video unavailable"), false);
  assert.equal(isBotCheckError(""), false);
  assert.equal(isBotCheckError(null), false);
});

// --- nguồn cookie cho luồng Sheet -------------------------------------------
// Có người CHỈ dùng Sheet, không bao giờ mở tab "Tải video", nên cookie phải set
// được ngay trong settings Sheet. Nhưng ai đang chạy Sheet bằng cookie ở tab Tải
// video thì không được mất cookie sau khi cập nhật -> trống mới lùi về đó.
test("settings Sheet có cookie thì thắng cấu hình tab Tải video", () => {
  const got = resolveSheetCookieSource(
    { cookiesFolder: "D:/ck-sheet" },
    { cookiesFolder: "D:/ck-tab", cookiesFile: "D:/tab.txt" },
  );
  assert.equal(got.folder, "D:/ck-sheet");
  assert.equal(got.file, null);
  assert.equal(got.source, "sheet");
});

// cookiesFile không còn ô nhập trong UI (chỉ còn thư mục), nhưng giá trị cũ vẫn phải
// dùng được: ai đang chạy bằng 1 file cookie mà mất sạch cookie sau khi cập nhật thì
// coi như app tự làm hỏng cấu hình của họ.
//
// Sheet được lấy NGUYÊN CỤM: đặt file trong Sheet mà lại đi mượn thư mục của tab
// Tải video thì không ai đoán được đang chạy bằng cookie nào.
test("Sheet chỉ có file đơn (cấu hình cũ) thì vẫn dùng Sheet, không mượn thư mục của tab", () => {
  const got = resolveSheetCookieSource(
    { cookiesFile: "D:/sheet.txt" },
    { cookiesFolder: "D:/ck-tab" },
  );
  assert.equal(got.folder, null);
  assert.equal(got.file, "D:/sheet.txt");
  assert.equal(got.source, "sheet");
});

test("settings Sheet trống thì lùi về cấu hình tab Tải video", () => {
  const got = resolveSheetCookieSource(
    { cookiesFolder: "  ", cookiesFile: "" },
    { cookiesFolder: "D:/ck-tab", cookiesFile: "D:/tab.txt" },
  );
  assert.equal(got.folder, "D:/ck-tab");
  assert.equal(got.file, "D:/tab.txt");
  assert.equal(got.source, "download");
});

test("không nơi nào có cookie thì trả rỗng, tải trần chứ không ném lỗi", () => {
  const got = resolveSheetCookieSource({}, {});
  assert.deepEqual(got, { folder: null, file: null, source: "none" });
  assert.deepEqual(resolveSheetCookieSource(null, null), { folder: null, file: null, source: "none" });
});
