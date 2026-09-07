// Chia lô để có điểm "hạ nhiệt" giữa các đợt tải. Điểm dễ sai: danh sách rỗng trả
// [[]] rồi chỗ gọi nghỉ 120s cho một lô không có gì.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkIntoBatches } from "../sheet/download-batch.js";

test("chia đúng lô khi danh sách dài hơn một lô", () => {
  assert.deepEqual(chunkIntoBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("danh sách ngắn hơn một lô thì gộp làm một, không nghỉ thừa", () => {
  assert.deepEqual(chunkIntoBatches([1, 2], 30), [[1, 2]]);
  assert.deepEqual(chunkIntoBatches([1, 2], 2), [[1, 2]]);
});

test("danh sách rỗng trả mảng rỗng, không phải [[]]", () => {
  assert.deepEqual(chunkIntoBatches([], 30), []);
  assert.deepEqual(chunkIntoBatches(null, 30), []);
});

// batchSize = 0 là lựa chọn cố ý "tắt chia lô", phải giữ nguyên hành vi cũ chứ không
// được hiểu thành lô rỗng rồi lặp vô hạn.
test("kích thước lô không hợp lệ thì tắt chia lô", () => {
  assert.deepEqual(chunkIntoBatches([1, 2, 3], 0), [[1, 2, 3]]);
  assert.deepEqual(chunkIntoBatches([1, 2, 3], -5), [[1, 2, 3]]);
  assert.deepEqual(chunkIntoBatches([1, 2, 3], "rác"), [[1, 2, 3]]);
  assert.deepEqual(chunkIntoBatches([1, 2, 3], undefined), [[1, 2, 3]]);
});

test("giữ nguyên thứ tự và không mất phần tử nào", () => {
  const urls = Array.from({ length: 95 }, (_, i) => `u${i}`);
  const batches = chunkIntoBatches(urls, 30);
  assert.equal(batches.length, 4);
  assert.deepEqual(batches.map((b) => b.length), [30, 30, 30, 5]);
  assert.deepEqual(batches.flat(), urls);
});
