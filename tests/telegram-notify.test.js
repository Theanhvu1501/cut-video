import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, sendTelegram } from "../sheet/telegram-notify.js";

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
