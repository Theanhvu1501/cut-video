import { test } from "node:test";
import assert from "node:assert/strict";
import { findThumbnailForVideo, basename } from "../sheet/thumb-match.js";

test("khớp basename chính xác, ưu tiên file ảnh", () => {
  const files = ["New Title.jpg", "New Title.mp4", "Other.png"];
  assert.equal(findThumbnailForVideo("New Title.mp4", files), "New Title.jpg");
});

test("khớp không phân biệt hoa/thường và dấu tiếng Việt", () => {
  const files = ["Câu Chuyện Đêm.png"];
  assert.equal(findThumbnailForVideo("cau chuyen dem.mp4", files), "Câu Chuyện Đêm.png");
});

test("hỗ trợ đường dẫn Windows và Unix", () => {
  const files = ["D:\\ch\\thumbs\\Alpha.webp", "/x/Beta.jpg"];
  assert.equal(findThumbnailForVideo("C:\\out\\Alpha.mp4", files), "D:\\ch\\thumbs\\Alpha.webp");
});

test("trả null khi không có ảnh khớp", () => {
  assert.equal(findThumbnailForVideo("Zzz.mp4", ["Alpha.jpg"]), null);
});

test("bỏ qua file không phải ảnh dù trùng tên", () => {
  assert.equal(findThumbnailForVideo("Alpha.mp4", ["Alpha.txt", "Alpha.srt"]), null);
});

test("basename xử lý cả hai kiểu path", () => {
  assert.equal(basename("D:\\a\\b\\c.jpg"), "c.jpg");
  assert.equal(basename("/a/b/c.jpg"), "c.jpg");
});
