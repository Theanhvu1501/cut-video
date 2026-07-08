import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePostTimes, assignTomorrowSlots } from "../sheet/schedule-slots.js";

test("parsePostTimes chuẩn hoá và lọc giá trị lỗi", () => {
  assert.deepEqual(parsePostTimes("8:00, 18:00"), ["08:00", "18:00"]);
  assert.deepEqual(parsePostTimes("  9:5 , 25:00, 12:30 "), ["12:30"]); // 9:5 sai định dạng, 25:00 quá giờ
  assert.deepEqual(parsePostTimes(""), []);
  assert.deepEqual(parsePostTimes(["07:00", "bad"]), ["07:00"]);
});

const NOW = new Date(2026, 6, 8, 15, 0, 0); // 2026-07-08 15:00 local

test("cấp slot của NGÀY MAI, dư thì không cấp (chờ)", () => {
  // 5 video chờ, 2 slot -> chỉ cấp 2 của ngày mai, 3 video còn lại chờ
  const r = assignTomorrowSlots(["08:00", "18:00"], [], NOW, 5);
  assert.deepEqual(r, ["2026-07-09T08:00:00", "2026-07-09T18:00:00"]);
});

test("bỏ qua slot đã dùng", () => {
  const r = assignTomorrowSlots(["08:00", "18:00"], ["2026-07-09T08:00:00"], NOW, 5);
  assert.deepEqual(r, ["2026-07-09T18:00:00"]);
});

test("chỉ cấp đúng số video đang chờ", () => {
  const r = assignTomorrowSlots(["08:00", "18:00"], [], NOW, 1);
  assert.deepEqual(r, ["2026-07-09T08:00:00"]);
});

test("hết slot ngày mai -> rỗng (video chờ lượt sau)", () => {
  const used = ["2026-07-09T08:00:00", "2026-07-09T18:00:00"];
  assert.deepEqual(assignTomorrowSlots(["08:00", "18:00"], used, NOW, 3), []);
});

test("không có postTimes -> rỗng", () => {
  assert.deepEqual(assignTomorrowSlots("", [], NOW, 2), []);
});

test("wantCount <= 0 -> rỗng", () => {
  assert.deepEqual(assignTomorrowSlots(["08:00"], [], NOW, 0), []);
});
