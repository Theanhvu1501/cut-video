import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDigest,
  sendTelegram,
  sendTelegramPhoto,
  buildChannelReport,
} from "../sheet/telegram-notify.js";

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

// ===== Tin báo của một kênh (ảnh + kết quả trong cùng một tin) =====

test("buildChannelReport chỉ đếm kết quả của đúng kênh đó", () => {
  const batch = [
    { sheetName: "line", title: "A", ok: true, scheduleISO: "2026-07-30T08:00:00" },
    { sheetName: "line", title: "B", ok: false, error: "b4 không thấy ô giờ" },
    { sheetName: "truyen", title: "C", ok: true, scheduleISO: "2026-07-30T18:00:00" },
  ];
  const line = buildChannelReport("line", batch);
  assert.match(line, /^📋 line — ✅ 1 lên lịch, ❌ 1 lỗi$/m);
  assert.match(line, /• A → 30\/07\/2026 08:00/);
  assert.match(line, /• ❌ B: b4 không thấy ô giờ/);
  assert.doesNotMatch(line, /truyen|• C/, "không được lẫn kết quả của kênh khác");

  assert.match(buildChannelReport("truyen", batch), /^📋 truyen — ✅ 1 lên lịch, ❌ 0 lỗi$/m);
});

test("buildChannelReport: thành công mà thiếu scheduleISO thì chỉ ghi tiêu đề", () => {
  const out = buildChannelReport("line", [{ sheetName: "line", title: "A", ok: true }]);
  assert.match(out, /• A$/m);
  assert.doesNotMatch(out, /→/);
});

test("buildChannelReport: 0 kết quả -> chuỗi rỗng", () => {
  assert.equal(buildChannelReport("line", []), "");
  assert.equal(buildChannelReport("line", [{ sheetName: "khac", title: "A", ok: true }]), "");
});

test("buildChannelReport: caption dài bị cắt trong 1024 và ghi rõ còn bao nhiêu", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    sheetName: "line", title: `Video số ${i} với tiêu đề dài dài dài`, ok: true,
    scheduleISO: "2026-07-30T08:00:00",
  }));
  const out = buildChannelReport("line", many);
  assert.ok(out.length <= 1024, `caption dài ${out.length} > 1024`);
  assert.match(out, /\n… và \d+ video nữa$/);
  assert.match(out, /^📋 line — ✅ 200 lên lịch, ❌ 0 lỗi$/m, "dòng tổng vẫn phải đủ số thật");
});

// ===== Retry khi dính 429 =====

test("sendTelegramPhoto: dính 429 thì chờ retry_after rồi gửi lại", async () => {
  const slept = [];
  let n = 0;
  const fetch = async () => {
    n++;
    return n === 1
      ? { json: async () => ({ ok: false, description: "Too Many Requests", parameters: { retry_after: 5 } }) }
      : { json: async () => ({ ok: true }) };
  };
  const r = await sendTelegramPhoto("TOK", "42", Buffer.from("PNG"), "c", {
    fetch, sleep: async (ms) => { slept.push(ms); },
  });

  assert.equal(r.ok, true);
  assert.equal(n, 2, "phải gửi lại chứ không vứt ảnh");
  assert.deepEqual(slept, [6000], "chờ retry_after + 1 giây");
});

test("sendTelegramPhoto: fetch ném lỗi mạng thì thử lại, không ném ra ngoài", async () => {
  let n = 0;
  const fetch = async () => {
    n++;
    if (n < 3) throw new Error("ECONNRESET");
    return { json: async () => ({ ok: true }) };
  };
  const r = await sendTelegramPhoto("TOK", "42", Buffer.from("PNG"), "c", { fetch, sleep: async () => {} });

  assert.equal(r.ok, true);
  assert.equal(n, 3);
});

test("sendTelegram (tin chữ) cũng chờ retry_after khi bị 429", async () => {
  const slept = [];
  let n = 0;
  const fetch = async () => {
    n++;
    return n === 1
      ? { json: async () => ({ ok: false, description: "Too Many Requests", parameters: { retry_after: 2 } }) }
      : { json: async () => ({ ok: true }) };
  };
  const r = await sendTelegram("TOK", "42", "hello", { fetch, sleep: async (ms) => { slept.push(ms); } });

  assert.equal(r.ok, true);
  assert.deepEqual(slept, [3000]);
});
