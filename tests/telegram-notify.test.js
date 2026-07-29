import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDigest,
  sendTelegram,
  sendTelegramPhoto,
  sendTelegramMediaGroup,
  buildShotCaption,
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

test("buildShotCaption chỉ đếm kết quả của đúng kênh đó", () => {
  const batch = [
    { sheetName: "line", title: "A", ok: true },
    { sheetName: "line", title: "B", ok: false, error: "x" },
    { sheetName: "truyen", title: "C", ok: true },
  ];
  assert.equal(buildShotCaption("line", batch), "📋 line — ✅ 1 lên lịch, ❌ 1 lỗi");
  assert.equal(buildShotCaption("truyen", batch), "📋 truyen — ✅ 1 lên lịch, ❌ 0 lỗi");
});

// ===== Gửi nhiều ảnh: album + chờ đúng retry_after khi dính 429 =====

const png = (n) => Buffer.from(`PNG${n}`);
const shots = (n) => Array.from({ length: n }, (_, i) => ({ photo: png(i), caption: `kênh ${i}` }));
const okJson = async () => ({ json: async () => ({ ok: true }) });

test("sendTelegramMediaGroup: nhiều ảnh gộp thành MỘT request sendMediaGroup", async () => {
  const calls = [];
  const fetch = async (url, opt) => { calls.push({ url, opt }); return okJson(); };
  const r = await sendTelegramMediaGroup("TOK", "42", shots(4), { fetch });

  assert.deepEqual(r, { ok: true, sent: 4 });
  assert.equal(calls.length, 1, "4 ảnh chỉ được tốn đúng 1 tin của Telegram");
  assert.match(calls[0].url, /^https:\/\/api\.telegram\.org\/botTOK\/sendMediaGroup$/);

  const form = calls[0].opt.body;
  assert.equal(form.get("chat_id"), "42");
  const media = JSON.parse(form.get("media"));
  assert.equal(media.length, 4);
  assert.deepEqual(media[2], { type: "photo", media: "attach://photo2", caption: "kênh 2" });
  const photo2 = form.get("photo2");
  assert.equal(Buffer.from(await photo2.arrayBuffer()).toString(), "PNG2");
});

test("sendTelegramMediaGroup: đúng 1 ảnh thì dùng sendPhoto (album cần >= 2)", async () => {
  const calls = [];
  const fetch = async (url, opt) => { calls.push({ url, opt }); return okJson(); };
  const r = await sendTelegramMediaGroup("TOK", "42", shots(1), { fetch });

  assert.deepEqual(r, { ok: true, sent: 1 });
  assert.match(calls[0].url, /\/sendPhoto$/);
  assert.equal(calls[0].opt.body.get("caption"), "kênh 0");
});

test("sendTelegramMediaGroup: quá 10 ảnh thì chia lô, lô lẻ 1 tấm dùng sendPhoto", async () => {
  const calls = [];
  const fetch = async (url, opt) => { calls.push({ url, opt }); return okJson(); };
  const r = await sendTelegramMediaGroup("TOK", "42", shots(11), { fetch });

  assert.deepEqual(r, { ok: true, sent: 11 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/sendMediaGroup$/);
  assert.equal(JSON.parse(calls[0].opt.body.get("media")).length, 10);
  assert.match(calls[1].url, /\/sendPhoto$/, "tấm thứ 11 đi một mình");
});

test("sendTelegramMediaGroup: dính 429 thì chờ retry_after rồi gửi lại", async () => {
  const slept = [];
  let n = 0;
  const fetch = async () => {
    n++;
    return n === 1
      ? { json: async () => ({ ok: false, description: "Too Many Requests", parameters: { retry_after: 5 } }) }
      : { json: async () => ({ ok: true }) };
  };
  const r = await sendTelegramMediaGroup("TOK", "42", shots(3), {
    fetch, sleep: async (ms) => { slept.push(ms); },
  });

  assert.deepEqual(r, { ok: true, sent: 3 });
  assert.equal(n, 2, "phải gửi lại chứ không vứt ảnh");
  assert.deepEqual(slept, [6000], "chờ retry_after + 1 giây");
});

test("sendTelegramMediaGroup: hết lượt thử vẫn 429 thì báo lỗi kèm số đã gửi", async () => {
  const fetch = async () => ({
    json: async () => ({ ok: false, description: "Too Many Requests", parameters: { retry_after: 1 } }),
  });
  const r = await sendTelegramMediaGroup("TOK", "42", shots(3), { fetch, sleep: async () => {} });

  assert.equal(r.ok, false);
  assert.equal(r.sent, 0);
  assert.match(r.error, /Too Many Requests/);
});

test("sendTelegramMediaGroup: lô đầu hỏng không kéo theo lô sau", async () => {
  let n = 0;
  const fetch = async () => {
    n++;
    return n === 1
      ? { json: async () => ({ ok: false, description: "PHOTO_INVALID_DIMENSIONS" }) }
      : { json: async () => ({ ok: true }) };
  };
  const r = await sendTelegramMediaGroup("TOK", "42", shots(11), { fetch, sleep: async () => {} });

  assert.equal(r.ok, false);
  assert.equal(r.sent, 1, "lô 10 tấm hỏng, tấm lẻ vẫn tới nơi");
  assert.match(r.error, /PHOTO_INVALID_DIMENSIONS/);
});

test("sendTelegramMediaGroup: fetch ném lỗi mạng thì thử lại, không ném ra ngoài", async () => {
  let n = 0;
  const fetch = async () => {
    n++;
    if (n < 3) throw new Error("ECONNRESET");
    return okJson();
  };
  const r = await sendTelegramMediaGroup("TOK", "42", shots(2), { fetch, sleep: async () => {} });

  assert.deepEqual(r, { ok: true, sent: 2 });
  assert.equal(n, 3);
});

test("sendTelegramMediaGroup: không có ảnh nào thì không gọi Telegram", async () => {
  let called = false;
  const fetch = async () => { called = true; return okJson(); };
  assert.deepEqual(await sendTelegramMediaGroup("TOK", "42", [], { fetch }), { ok: true, sent: 0 });
  assert.equal(called, false);
  assert.deepEqual(await sendTelegramMediaGroup("", "42", shots(2), { fetch }), {
    ok: false, error: "thiếu token/chatId", sent: 0,
  });
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
