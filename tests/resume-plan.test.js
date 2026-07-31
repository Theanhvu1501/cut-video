import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction, skipText, MAX_ATTEMPTS, ST } from "../sheet/resume-plan.js";

const base = {
  statusB: "", statusC: "", attempts: 0, uploadAttempts: 0,
  overlayExists: false, outputExists: false,
};
const d = (o) => decideAction({ ...base, ...o });

test("ô B rỗng -> tải và render từ đầu", () => {
  assert.equal(d({}), "full");
  // Kể cả khi biến đếm cũ còn sót: ô rỗng nghĩa là người dùng muốn làm lại.
  assert.equal(d({ attempts: 99 }), "full");
});

test("đã tải mà file còn -> chỉ render", () => {
  assert.equal(d({ statusB: ST.DOWNLOADED, overlayExists: true }), "render-only");
  assert.equal(d({ statusB: `${ST.ERR_RENDER} ffmpeg chết`, overlayExists: true }), "render-only");
});

test("đã tải mà file bị xoá tay -> tải lại từ đầu", () => {
  assert.equal(d({ statusB: ST.DOWNLOADED, overlayExists: false }), "full");
  assert.equal(d({ statusB: `${ST.ERR_RENDER} x`, overlayExists: false }), "full");
});

test("lỗi tải -> tải lại từ đầu", () => {
  assert.equal(d({ statusB: `${ST.ERR_DL} mạng hỏng` }), "full");
});

test("render xong, upload lỗi, file output còn -> chỉ upload", () => {
  assert.equal(
    d({ statusB: ST.DONE, statusC: "❌ lỗi: GPM mất kết nối", outputExists: true }),
    "upload-only",
  );
});

test("render xong, upload lỗi, hết lượt thử -> báo hết lượt", () => {
  assert.equal(
    d({ statusB: ST.DONE, statusC: "❌ lỗi: x", outputExists: true, uploadAttempts: MAX_ATTEMPTS }),
    "upload-exhausted",
  );
});

test("render xong, upload lỗi, file output đã bị xoá -> bỏ qua", () => {
  assert.equal(d({ statusB: ST.DONE, statusC: "❌ lỗi: x", outputExists: false }), "skip");
});

test("chưa upload được vì hạ tầng (⏸ chờ) -> upload lại, KHÔNG tính lượt", () => {
  const c = `${ST.WAIT_UPLOAD} chưa kết nối được GPM`;
  assert.equal(d({ statusB: ST.DONE, statusC: c, outputExists: true }), "upload-wait");
  // Không tính vào uploadAttempts: quên mở GPM 99 lượt cũng không bị chôn.
  assert.equal(
    d({ statusB: ST.DONE, statusC: c, outputExists: true, uploadAttempts: 99 }),
    "upload-wait",
  );
});

test("⏸ chờ nhưng mất file output -> bỏ qua", () => {
  assert.equal(
    d({ statusB: ST.DONE, statusC: `${ST.WAIT_UPLOAD} hết slot ngày mai`, outputExists: true }),
    "upload-wait",
  );
  assert.equal(
    d({ statusB: ST.DONE, statusC: `${ST.WAIT_UPLOAD} hết slot ngày mai`, outputExists: false }),
    "skip",
  );
});

// "⏳ đang upload" nghĩa là upload CÓ THỂ đã bắt đầu (app bị tắt giữa chừng).
// Thử lại là tạo video trùng trên YouTube -> phải bỏ qua, chờ người dùng xử lý tay.
test("kẹt ở ⏳ đang upload -> KHÔNG tự upload lại", () => {
  assert.equal(d({ statusB: ST.DONE, statusC: "⏳ đang upload", outputExists: true }), "skip");
});

test("render xong và upload xong -> bỏ qua", () => {
  assert.equal(d({ statusB: ST.DONE, statusC: "✅ lên lịch 10/07 07:00", outputExists: true }), "skip");
});

test("đã đánh dấu bỏ qua -> không đụng tới nữa", () => {
  assert.equal(d({ statusB: skipText("hỏng"), overlayExists: true }), "skip");
});

test("chạm trần số lần thử -> bỏ qua", () => {
  assert.equal(d({ statusB: ST.DOWNLOADED, overlayExists: true, attempts: MAX_ATTEMPTS }), "skip");
});

test("trạng thái lạ -> bỏ qua, không đoán", () => {
  assert.equal(d({ statusB: "đang chạy dở???" }), "skip");
});

test("uploadStatus undefined được coi như rỗng", () => {
  assert.equal(decideAction({ ...base, statusB: ST.DONE, statusC: undefined }), "skip");
});

test("skipText có đủ lý do và số lần", () => {
  assert.equal(skipText("ffmpeg chết"), "bỏ qua: ffmpeg chết (đã thử 3 lần)");
});
