import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, sendTelegram, sendTelegramPhoto, buildShotCaption } from "../sheet/telegram-notify.js";

test("buildDigest gộp theo kênh + liệt kê lỗi", () => {
  const out = buildDigest([
    { sheetName: "line", title: "A", ok: true, scheduleISO: "2026-07-09T08:00:00" },
    { sheetName: "line", title: "B", ok: false, error: "b4 không thấy ô giờ" },
    { sheetName: "truyen", title: "C", ok: true },
  ]);
  assert.match(out, /✅ 2 lên lịch, ❌ 1 lỗi/);
  assert.match(out, /line: ✅ 1 \| ❌ 1/);
  assert.match(out, /truyen: ✅ 1 \| ❌ 0/);
  assert.match(out, /line · B: b4 không thấy ô giờ/);
});

test("buildDigest không liệt kê chi tiết các video đã lên lịch", () => {
  const out = buildDigest([
    { sheetName: "line", title: "Video A", ok: true, scheduleISO: "2026-07-09T08:00:00" },
    { sheetName: "line", title: "Video B", ok: false, error: "b4 không thấy ô giờ" },
  ]);
  assert.doesNotMatch(out, /Đã lên lịch:/);
  assert.doesNotMatch(out, /Video A/, "tiêu đề video thành công không được liệt kê");
  assert.doesNotMatch(out, /09\/07\/2026/, "giờ lịch không được liệt kê");
  // Phần tổng kết và phần lỗi vẫn giữ nguyên.
  assert.match(out, /✅ 1 lên lịch, ❌ 1 lỗi/);
  assert.match(out, /line: ✅ 1 \| ❌ 1/);
  assert.match(out, /❌ Chi tiết lỗi:/);
  assert.match(out, /line · Video B: b4 không thấy ô giờ/);
});

test("buildDigest rỗng khi không có kết quả", () => {
  assert.equal(buildDigest([]), "");
});

test("sendTelegram gọi đúng URL + body, báo lỗi thiếu token", async () => {
  assert.deepEqual(await sendTelegram("", "1", "x"), { ok: false, error: "thiếu token/chatId" });

  let calledUrl, calledBody;
  const fetch = async (url, opt) => {
    calledUrl = url;
    calledBody = JSON.parse(opt.body);
    return { json: async () => ({ ok: true }) };
  };
  const r = await sendTelegram("TOK", "42", "hello", { fetch });
  assert.equal(r.ok, true);
  assert.match(calledUrl, /^https:\/\/api\.telegram\.org\/botTOK\/sendMessage$/);
  assert.deepEqual(calledBody, { chat_id: "42", text: "hello" });
});

test("sendTelegramPhoto gửi multipart đúng field, báo lỗi thiếu token", async () => {
  assert.deepEqual(
    await sendTelegramPhoto("", "1", Buffer.from("x"), "c"),
    { ok: false, error: "thiếu token/chatId" },
  );

  let calledUrl, calledOpt;
  const fetch = async (url, opt) => {
    calledUrl = url;
    calledOpt = opt;
    return { json: async () => ({ ok: true }) };
  };
  const r = await sendTelegramPhoto("TOK", "42", Buffer.from("PNGDATA"), "xin chào", { fetch });
  assert.equal(r.ok, true);
  assert.match(calledUrl, /^https:\/\/api\.telegram\.org\/botTOK\/sendPhoto$/);
  assert.equal(calledOpt.method, "POST");
  // KHÔNG được tự đặt Content-Type: fetch phải sinh boundary của multipart.
  assert.equal(calledOpt.headers, undefined);
  assert.ok(calledOpt.body instanceof FormData);
  assert.equal(calledOpt.body.get("chat_id"), "42");
  assert.equal(calledOpt.body.get("caption"), "xin chào");
  const photo = calledOpt.body.get("photo");
  assert.equal(typeof photo.arrayBuffer, "function", "photo phải là Blob/File");
  assert.equal(photo.name, "content.png");
  assert.equal(Buffer.from(await photo.arrayBuffer()).toString(), "PNGDATA");
});

test("sendTelegramPhoto cắt caption dài quá giới hạn 1024 của Telegram", async () => {
  let calledOpt;
  const fetch = async (url, opt) => { calledOpt = opt; return { json: async () => ({ ok: true }) }; };
  await sendTelegramPhoto("TOK", "42", Buffer.from("x"), "a".repeat(2000), { fetch });
  assert.equal(calledOpt.body.get("caption").length, 1024);
});

test("sendTelegramPhoto trả lỗi khi Telegram từ chối", async () => {
  const fetch = async () => ({ json: async () => ({ ok: false, description: "PHOTO_INVALID_DIMENSIONS" }) });
  const r = await sendTelegramPhoto("TOK", "42", Buffer.from("x"), "c", { fetch });
  assert.deepEqual(r, { ok: false, error: "PHOTO_INVALID_DIMENSIONS" });
});

test("buildShotCaption chỉ đếm kết quả của đúng kênh đó", () => {
  const batch = [
    { sheetName: "line", title: "A", ok: true },
    { sheetName: "line", title: "B", ok: false, error: "x" },
    { sheetName: "truyen", title: "C", ok: true },
  ];
  assert.equal(buildShotCaption("line", batch), "📋 line — ✅ 1 lên lịch, ❌ 1 lỗi");
  assert.equal(buildShotCaption("truyen", batch), "📋 truyen — ✅ 1 lên lịch, ❌ 0 lỗi");
});
