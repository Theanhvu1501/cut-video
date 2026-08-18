import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePostTimes, assignTomorrowSlots, formatSchedule, parseScheduledISO, formatStamp } from "../sheet/schedule-slots.js";

test("formatSchedule đổi ISO -> dd/mm/yyyy hh:mm", () => {
  assert.equal(formatSchedule("2026-07-09T08:00:00"), "09/07/2026 08:00");
  assert.equal(formatSchedule("2026-12-31T18:30:00"), "31/12/2026 18:30");
  assert.equal(formatSchedule(""), "");
});

test("parseScheduledISO trích ISO từ text cột C (đảo của formatSchedule)", () => {
  assert.equal(parseScheduledISO("✅ lên lịch 09/07/2026 08:00"), "2026-07-09T08:00:00");
  assert.equal(parseScheduledISO("⏳ đang upload"), null);
  assert.equal(parseScheduledISO(""), null);
  // round-trip
  const iso = "2026-07-09T18:00:00";
  assert.equal(parseScheduledISO(formatSchedule(iso)), iso);
});

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

test("giờ lặp N lần -> N video CÙNG giờ đó", () => {
  const r = assignTomorrowSlots(["08:00", "08:00", "08:00"], [], NOW, 3);
  assert.deepEqual(r, ["2026-07-09T08:00:00", "2026-07-09T08:00:00", "2026-07-09T08:00:00"]);
});

test("giờ lặp: đã dùng 1 lượt thì vẫn còn lượt cho video sau", () => {
  const r = assignTomorrowSlots(["08:00", "08:00"], ["2026-07-09T08:00:00"], NOW, 5);
  assert.deepEqual(r, ["2026-07-09T08:00:00"]);
});

test("giờ lặp: dùng hết số lượt của giờ đó -> không cấp nữa", () => {
  const used = ["2026-07-09T08:00:00", "2026-07-09T08:00:00"];
  assert.deepEqual(assignTomorrowSlots(["08:00", "08:00"], used, NOW, 3), []);
});

test("giờ lặp xen kẽ: chỉ trừ đúng lượt đã dùng của từng giờ", () => {
  const r = assignTomorrowSlots(["08:00", "18:00", "08:00"], ["2026-07-09T08:00:00"], NOW, 5);
  assert.deepEqual(r, ["2026-07-09T18:00:00", "2026-07-09T08:00:00"]);
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

test("formatStamp: Date -> dd/mm/yyyy hh:mm", () => {
  assert.equal(formatStamp(new Date(2026, 6, 9, 14, 32)), "09/07/2026 14:32");
  assert.equal(formatStamp(new Date(2026, 11, 1, 8, 5)), "01/12/2026 08:05");
});
