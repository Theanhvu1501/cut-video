import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePostTimes, computeNextSlot } from "../sheet/schedule-slots.js";

test("parsePostTimes chuẩn hoá và lọc giá trị lỗi", () => {
  assert.deepEqual(parsePostTimes("8:00, 18:00"), ["08:00", "18:00"]);
  assert.deepEqual(parsePostTimes("  9:5 , 25:00, 12:30 "), ["12:30"]); // 9:5 sai định dạng, 25:00 quá giờ
  assert.deepEqual(parsePostTimes(""), []);
  assert.deepEqual(parsePostTimes(["07:00", "bad"]), ["07:00"]);
});

const NOW = new Date(2026, 6, 8, 15, 0, 0); // 2026-07-08 15:00 local

test("lần đầu (con trỏ rỗng) -> slot đầu tiên của NGÀY MAI", () => {
  const r = computeNextSlot(null, ["08:00", "18:00"], NOW);
  assert.equal(r.slot, "2026-07-09T08:00:00");
  assert.equal(r.next, "2026-07-09T18:00:00");
});

test("điền tuần tự trong ngày rồi tràn sang ngày kế", () => {
  let ptr = null;
  const slots = [];
  for (let i = 0; i < 3; i++) {
    const r = computeNextSlot(ptr, ["08:00", "18:00"], NOW);
    slots.push(r.slot);
    ptr = r.next;
  }
  assert.deepEqual(slots, [
    "2026-07-09T08:00:00",
    "2026-07-09T18:00:00",
    "2026-07-10T08:00:00",
  ]);
});

test("con trỏ ở quá khứ bị kéo về ngày mai (không đăng hôm nay)", () => {
  const r = computeNextSlot("2026-07-01T08:00:00", ["08:00", "18:00"], NOW);
  assert.equal(r.slot, "2026-07-09T08:00:00");
});

test("con trỏ tương lai hợp lệ được giữ nguyên", () => {
  const r = computeNextSlot("2026-07-12T18:00:00", ["08:00", "18:00"], NOW);
  assert.equal(r.slot, "2026-07-12T18:00:00");
  assert.equal(r.next, "2026-07-13T08:00:00");
});

test("một slot mỗi ngày -> mỗi video sang ngày kế", () => {
  const r1 = computeNextSlot(null, ["09:00"], NOW);
  assert.equal(r1.slot, "2026-07-09T09:00:00");
  assert.equal(r1.next, "2026-07-10T09:00:00");
});

test("không có postTimes -> null", () => {
  assert.equal(computeNextSlot(null, "", NOW), null);
});
