import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { keyOf, loadResume, saveResume, getEntry, setEntry, clearEntry } from "../sheet/resume-state.js";

test("keyOf dùng videoId, rơi về url khi không parse được", () => {
  assert.equal(keyOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(keyOf("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(keyOf("u1"), "u1");
});

test("setEntry khởi tạo biến đếm rồi merge patch", () => {
  const s = {};
  const e = setEntry(s, "Kênh A", "u1", { stage: "downloaded", filePath: "/ov/a.mp4" });
  assert.deepEqual(e, { attempts: 0, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/a.mp4" });
  setEntry(s, "Kênh A", "u1", { attempts: 1 });
  assert.equal(getEntry(s, "Kênh A", "u1").attempts, 1);
  assert.equal(getEntry(s, "Kênh A", "u1").filePath, "/ov/a.mp4");
});

test("getEntry trả null khi chưa có", () => {
  assert.equal(getEntry({}, "Kênh A", "u1"), null);
  assert.equal(getEntry({ "Kênh A": {} }, "Kênh A", "u1"), null);
});

test("clearEntry xoá entry và xoá luôn kênh khi rỗng", () => {
  const s = {};
  setEntry(s, "Kênh A", "u1", { stage: "rendered" });
  setEntry(s, "Kênh A", "u2", { stage: "rendered" });
  clearEntry(s, "Kênh A", "u1");
  assert.equal(getEntry(s, "Kênh A", "u1"), null);
  assert.ok(s["Kênh A"]);
  clearEntry(s, "Kênh A", "u2");
  assert.equal(s["Kênh A"], undefined);
});

test("clearEntry trên kênh không tồn tại không ném lỗi", () => {
  const s = {};
  clearEntry(s, "Không có", "u1");
  assert.deepEqual(s, {});
});

test("loadResume trả {} khi file thiếu hoặc hỏng; saveResume ghi rồi đọc lại được", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-"));
  const p = path.join(dir, "nested", "resume-state.json");
  assert.deepEqual(loadResume(p), {});

  const s = {};
  setEntry(s, "Kênh A", "https://youtu.be/dQw4w9WgXcQ", { stage: "downloaded" });
  saveResume(p, s);
  assert.deepEqual(loadResume(p), s);

  fs.writeFileSync(p, "{ không phải json", "utf-8");
  assert.deepEqual(loadResume(p), {});

  fs.rmSync(dir, { recursive: true, force: true });
});
