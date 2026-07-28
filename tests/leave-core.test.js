import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLeave, grantedAsOf, expiryOf, DEFAULT_POLICY } from "../leave/leave-core.js";

// NV A: vào chính thức tháng 10/2026 -> T10, T11, T12 mỗi tháng 1 ngày
const A = "2026-10-15";

test("NV A: 3 ngày phép cho năm 2026, hạn dùng hết 31/03/2027", () => {
  const r = computeLeave({ officialStart: A, asOf: "2026-12-31" });
  assert.equal(r.balance, 3);
  assert.equal(r.buckets.length, 1);
  assert.deepEqual(r.buckets[0], {
    year: 2026, granted: 3, used: 0, remaining: 3, expired: false, expiresOn: "2027-03-31",
  });
  assert.deepEqual(r.expiringSoon, { year: 2026, remaining: 3, expiresOn: "2027-03-31" });
});

test("vào giữa tháng vẫn tính tròn 1 ngày cho tháng đó", () => {
  for (const d of ["2026-10-01", "2026-10-15", "2026-10-31"]) {
    assert.equal(computeLeave({ officialStart: d, asOf: "2026-12-31" }).balance, 3, d);
  }
});

test("phép của tháng cộng ngay từ đầu tháng", () => {
  assert.equal(computeLeave({ officialStart: A, asOf: "2026-10-16" }).balance, 1);
  assert.equal(computeLeave({ officialStart: A, asOf: "2026-11-01" }).balance, 2);
  assert.equal(computeLeave({ officialStart: A, asOf: "2026-12-01" }).balance, 3);
});

test("năm thứ hai cấp trọn 12 ngày ngay 01/01, không tích dần", () => {
  const r = computeLeave({ officialStart: A, asOf: "2027-01-01" });
  assert.equal(r.balance, 15); // 3 của 2026 + 12 của 2027
  assert.equal(r.buckets[1].granted, 12);
  // giữa năm vẫn là 12 chứ không tăng thêm
  assert.equal(computeLeave({ officialStart: A, asOf: "2027-07-15" }).buckets[1].granted, 12);
});

test("trong quý 1 trừ quỹ năm cũ trước", () => {
  const r = computeLeave({
    officialStart: A, asOf: "2027-02-20",
    taken: [{ date: "2027-02-10", days: 2 }],
  });
  assert.equal(r.buckets[0].used, 2); // 2026 bị trừ trước
  assert.equal(r.buckets[1].used, 0); // 2027 còn nguyên
  assert.equal(r.balance, 13); // 1 + 12
  assert.deepEqual(r.expiringSoon, { year: 2026, remaining: 1, expiresOn: "2027-03-31" });
});

test("nghỉ nhiều hơn quỹ cũ thì tràn sang quỹ mới", () => {
  const r = computeLeave({
    officialStart: A, asOf: "2027-02-20",
    taken: [{ date: "2027-02-10", days: 5 }],
  });
  assert.equal(r.buckets[0].used, 3);
  assert.equal(r.buckets[1].used, 2);
  assert.equal(r.balance, 10);
  assert.equal(r.shortfall.length, 0);
});

test("qua 31/03 thì phần chưa nghỉ của năm cũ bị xoá", () => {
  const r = computeLeave({
    officialStart: A, asOf: "2027-04-01",
    taken: [{ date: "2027-02-10", days: 2 }],
  });
  assert.equal(r.buckets[0].expired, true);
  assert.equal(r.buckets[0].remaining, 0);
  assert.equal(r.forfeited, 1); // 3 - 2 = 1 ngày mất trắng
  assert.equal(r.balance, 12); // chỉ còn quỹ 2027
});

test("nghỉ đúng ngày 31/03 vẫn được trừ vào quỹ năm cũ", () => {
  const r = computeLeave({
    officialStart: A, asOf: "2027-04-30",
    taken: [{ date: "2027-03-31", days: 3 }],
  });
  assert.equal(r.buckets[0].used, 3);
  assert.equal(r.forfeited, 0);
  assert.equal(r.balance, 12);
});

test("nghỉ từ 01/04 không đụng được vào quỹ năm cũ nữa", () => {
  const r = computeLeave({
    officialStart: A, asOf: "2027-04-30",
    taken: [{ date: "2027-04-01", days: 3 }],
  });
  assert.equal(r.buckets[0].used, 0);
  assert.equal(r.buckets[1].used, 3);
  assert.equal(r.forfeited, 3); // 3 ngày của 2026 mất vì không nghỉ kịp
  assert.equal(r.balance, 9);
});

test("nghỉ vượt tổng quỹ thì báo shortfall, số dư không âm", () => {
  const r = computeLeave({
    officialStart: A, asOf: "2026-12-31",
    taken: [{ date: "2026-12-20", days: 5, note: "nghỉ tết dương" }],
  });
  assert.equal(r.balance, 0);
  assert.deepEqual(r.shortfall, [{ date: "2026-12-20", days: 2, note: "nghỉ tết dương" }]);
});

test("nghỉ khi phép chưa kịp cộng thì thiếu, cộng đủ sau đó vẫn không bù ngược", () => {
  const r = computeLeave({
    officialStart: A, asOf: "2026-12-31",
    taken: [{ date: "2026-10-20", days: 3 }],
  });
  assert.deepEqual(r.shortfall, [{ date: "2026-10-20", days: 2, note: undefined }]);
  assert.equal(r.balance, 2); // 3 ngày cộng đủ, đã trừ 1
});

test("các lần nghỉ được xử lý theo thứ tự thời gian dù truyền lộn xộn", () => {
  const taken = [
    { date: "2027-03-01", days: 1 },
    { date: "2026-11-05", days: 1 },
    { date: "2027-01-10", days: 1 },
  ];
  const a = computeLeave({ officialStart: A, asOf: "2027-03-15", taken });
  const b = computeLeave({ officialStart: A, asOf: "2027-03-15", taken: [...taken].reverse() });
  assert.deepEqual(a, b);
  assert.equal(a.buckets[0].used, 3); // cả 3 lần đều rơi vào quỹ 2026
  assert.equal(a.balance, 12);
});

test("nghỉ nửa ngày", () => {
  const r = computeLeave({
    officialStart: A, asOf: "2026-12-31",
    taken: [{ date: "2026-11-05", days: 0.5 }, { date: "2026-12-05", days: 0.5 }],
  });
  assert.equal(r.balance, 2);
  assert.equal(r.buckets[0].used, 1);
});

test("người vào từ tháng 1 thì năm đầu vẫn tích dần đủ 12", () => {
  const r = computeLeave({ officialStart: "2026-01-10", asOf: "2026-12-31" });
  assert.equal(r.balance, 12);
  assert.equal(computeLeave({ officialStart: "2026-01-10", asOf: "2026-06-30" }).balance, 6);
});

test("người vào tháng 12 chỉ có 1 ngày cho năm đó", () => {
  const r = computeLeave({ officialStart: "2026-12-20", asOf: "2027-01-05" });
  assert.equal(r.buckets[0].granted, 1);
  assert.equal(r.balance, 13);
});

test("quỹ nhiều năm: 2028 trở đi mỗi năm 12 ngày, năm nào quá hạn thì rụng", () => {
  const r = computeLeave({ officialStart: A, asOf: "2028-05-01" });
  assert.deepEqual(r.buckets.map((b) => [b.year, b.granted, b.expired]), [
    [2026, 3, true], [2027, 12, true], [2028, 12, false],
  ]);
  assert.equal(r.forfeited, 15); // 3 của 2026 + 12 của 2027 đều không nghỉ
  assert.equal(r.balance, 12);
});

test("grantedAsOf và expiryOf dùng riêng được", () => {
  assert.equal(expiryOf(2026), "2027-03-31");
  assert.equal(grantedAsOf(2026, A, "2026-11-30"), 2);
  assert.equal(grantedAsOf(2027, A, "2027-01-01"), 12);
  assert.equal(grantedAsOf(2027, A, "2026-12-31"), 0); // chưa tới năm 2027
  assert.equal(grantedAsOf(2025, A, "2027-01-01"), 0); // chưa vào làm
});

test("policy đổi được: cấp 15 ngày, hạn dùng tới 30/06", () => {
  const policy = { ...DEFAULT_POLICY, annualGrant: 15, carryOverUntil: "06-30" };
  const r = computeLeave({ officialStart: A, asOf: "2027-04-01", policy });
  assert.equal(r.buckets[0].expired, false); // 31/03 chưa phải hạn nữa
  assert.equal(r.balance, 18); // 3 + 15
  assert.equal(r.buckets[1].expiresOn, "2028-06-30");
});

test("dữ liệu hỏng thì ném lỗi rõ ràng", () => {
  assert.throws(() => computeLeave({ officialStart: "15/10/2026", asOf: "2026-12-31" }), /YYYY-MM-DD/);
  assert.throws(() => computeLeave({ officialStart: A, asOf: "2026-13-01" }), /không phải ngày hợp lệ/);
  assert.throws(() => computeLeave({ officialStart: A, asOf: "2026-01-01" }), /không được trước/);
  assert.throws(
    () => computeLeave({ officialStart: A, asOf: "2026-12-31", taken: [{ date: "2026-11-01", days: 0 }] }),
    /số dương/
  );
});
