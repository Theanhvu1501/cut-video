import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDigest,
  sendTelegram,
  sendTelegramPhoto,
  buildChannelReport,
  parseTopicId,
} from "../sheet/telegram-notify.js";

test("buildDigest gộp theo kênh, chỉ đếm số", () => {
  const out = buildDigest([
    { sheetName: "line", title: "A", ok: true, scheduleISO: "2026-07-09T08:00:00" },
    { sheetName: "line", title: "B", ok: false, error: "b4 không thấy ô giờ" },
    { sheetName: "truyen", title: "C", ok: true },
  ]);
  assert.match(out, /✅ 2 lên lịch, ❌ 1 lỗi/);
  assert.match(out, /line: ✅ 1 \| ❌ 1/);
  assert.match(out, /truyen: ✅ 1 \| ❌ 0/);
});

// Tiêu đề video, giờ lịch và lý do lỗi đều đã nằm ở cột C của tab kênh.
// Tin Telegram chỉ cần con số; chi tiết từng video làm tin dài mà không thêm gì.
test("buildDigest không liệt kê chi tiết từng video, kể cả video lỗi", () => {
  const out = buildDigest([
    { sheetName: "line", title: "Video A", ok: true, scheduleISO: "2026-07-09T08:00:00" },
    { sheetName: "line", title: "Video B", ok: false, error: "b4 không thấy ô giờ" },
  ]);
  assert.doesNotMatch(out, /Video A/, "tiêu đề video thành công không được liệt kê");
  assert.doesNotMatch(out, /Video B/, "tiêu đề video lỗi cũng không được liệt kê");
  assert.doesNotMatch(out, /09\/07\/2026/, "giờ lịch không được liệt kê");
  assert.doesNotMatch(out, /Chi tiết lỗi/);
  assert.doesNotMatch(out, /b4 không thấy ô giờ/, "lý do lỗi đã có ở cột C");
  // Phần đếm vẫn giữ nguyên.
  assert.match(out, /✅ 1 lên lịch, ❌ 1 lỗi/);
  assert.match(out, /line: ✅ 1 \| ❌ 1/);
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

// Thiếu header này thì fetch tự gán "text/plain;charset=UTF-8", Telegram không
// đọc nổi body và trả "Bad Request: request body is empty" — nút "gửi thử" chết.
test("sendTelegram khai báo Content-Type: application/json", async () => {
  let headers;
  const fetch = async (url, opt) => { headers = opt.headers; return { json: async () => ({ ok: true }) }; };
  await sendTelegram("TOK", "42", "hello", { fetch });
  const ct = new Headers(headers).get("content-type");
  assert.equal(ct, "application/json");
});

// Ngược lại với sendMessage: multipart PHẢI để fetch tự sinh boundary.
test("sendTelegramPhoto KHÔNG tự đặt Content-Type", async () => {
  let opt;
  const fetch = async (u, o) => { opt = o; return { json: async () => ({ ok: true }) }; };
  await sendTelegramPhoto("TOK", "42", Buffer.from("x"), "c", { fetch });
  const ct = opt.headers ? new Headers(opt.headers).get("content-type") : null;
  assert.equal(ct, null, "đặt tay là hỏng boundary của multipart");
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

// ===== Topic của group (nhiều máy chung 1 group, mỗi máy 1 topic) =====

test("parseTopicId nhận số trần lẫn link topic, bỏ qua giá trị rác", () => {
  assert.equal(parseTopicId("45"), 45);
  assert.equal(parseTopicId(" 45 "), 45);
  assert.equal(parseTopicId(45), 45);
  // Chuột phải topic → Copy Link ra dạng này, người dùng dán thẳng vào ô.
  assert.equal(parseTopicId("https://t.me/c/1234567890/45"), 45);
  assert.equal(parseTopicId(""), undefined);
  assert.equal(parseTopicId(null), undefined);
  assert.equal(parseTopicId(undefined), undefined);
  assert.equal(parseTopicId("abc"), undefined);
  assert.equal(parseTopicId("0"), undefined);
  assert.equal(parseTopicId("-5"), undefined);
});

test("sendTelegram kèm message_thread_id khi có topic", async () => {
  let body;
  const fetch = async (u, o) => { body = JSON.parse(o.body); return { json: async () => ({ ok: true }) }; };
  await sendTelegram("TOK", "-1001234567890", "hello", { fetch, threadId: "45" });
  assert.deepEqual(body, { chat_id: "-1001234567890", text: "hello", message_thread_id: 45 });
});

// Bỏ trống ô Topic ID thì request phải giống hệt trước khi có tính năng này —
// kèm message_thread_id vào group chưa bật Topics là Telegram từ chối, mất tin.
test("sendTelegram không kèm message_thread_id khi topic trống/rác", async () => {
  const bodies = [];
  const fetch = async (u, o) => { bodies.push(JSON.parse(o.body)); return { json: async () => ({ ok: true }) }; };
  for (const threadId of ["", null, undefined, "abc"]) {
    await sendTelegram("TOK", "42", "hello", { fetch, threadId });
  }
  for (const b of bodies) assert.ok(!("message_thread_id" in b), `dư field với ${JSON.stringify(b)}`);
});

test("sendTelegramPhoto kèm message_thread_id khi có topic", async () => {
  let opt;
  const fetch = async (u, o) => { opt = o; return { json: async () => ({ ok: true }) }; };
  await sendTelegramPhoto("TOK", "42", Buffer.from("x"), "c", { fetch, threadId: "https://t.me/c/999/45" });
  assert.equal(opt.body.get("message_thread_id"), "45");
});

test("sendTelegramPhoto không kèm message_thread_id khi topic trống", async () => {
  let opt;
  const fetch = async (u, o) => { opt = o; return { json: async () => ({ ok: true }) }; };
  await sendTelegramPhoto("TOK", "42", Buffer.from("x"), "c", { fetch });
  assert.equal(opt.body.get("message_thread_id"), null);
});

// ===== Tin báo của một kênh (ảnh + kết quả trong cùng một tin) =====

test("buildChannelReport chỉ đếm kết quả của đúng kênh đó", () => {
  const batch = [
    { sheetName: "line", title: "A", ok: true, scheduleISO: "2026-07-30T08:00:00" },
    { sheetName: "line", title: "B", ok: false, error: "b4 không thấy ô giờ" },
    { sheetName: "truyen", title: "C", ok: true, scheduleISO: "2026-07-30T18:00:00" },
  ];
  assert.equal(buildChannelReport("line", batch), "📋 line — ✅ 1 lên lịch, ❌ 1 lỗi");
  assert.equal(buildChannelReport("truyen", batch), "📋 truyen — ✅ 1 lên lịch, ❌ 0 lỗi");
});

// Caption của ảnh chỉ còn đúng một dòng đếm — không liệt kê video nào nữa.
test("buildChannelReport: đúng một dòng, không có tiêu đề/giờ/lý do lỗi", () => {
  const out = buildChannelReport("line", [
    { sheetName: "line", title: "Video A", ok: true, scheduleISO: "2026-07-30T08:00:00" },
    { sheetName: "line", title: "Video B", ok: false, error: "b4 không thấy ô giờ" },
  ]);
  assert.equal(out.split("\n").length, 1, `phải đúng 1 dòng, đang là:\n${out}`);
  assert.doesNotMatch(out, /Video A|Video B/);
  assert.doesNotMatch(out, /30\/07\/2026/);
  assert.doesNotMatch(out, /b4 không thấy ô giờ/);
});

test("buildChannelReport: 0 kết quả -> chuỗi rỗng", () => {
  assert.equal(buildChannelReport("line", []), "");
  assert.equal(buildChannelReport("line", [{ sheetName: "khac", title: "A", ok: true }]), "");
});

test("buildChannelReport: nhiều video vẫn gọn trong giới hạn caption 1024", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    sheetName: "line", title: `Video số ${i} với tiêu đề dài dài dài`, ok: true,
    scheduleISO: "2026-07-30T08:00:00",
  }));
  const out = buildChannelReport("line", many);
  assert.ok(out.length <= 1024, `caption dài ${out.length} > 1024`);
  assert.equal(out, "📋 line — ✅ 200 lên lịch, ❌ 0 lỗi");
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
