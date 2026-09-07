// Retry dùng chung cho cả tải thủ công lẫn tải theo Sheet. Điểm dễ sai: retry mọi
// lỗi. Lỗi mạng hay "Video unavailable" mà đổi cookie thử lại thì chỉ tốn thời gian
// và giấu mất nguyên nhân thật — chỉ bot-check mới được rotate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadWithRetry } from "../sheet/download-retry.js";

// Pool giả: cookie là chuỗi, rotate chạy vòng tròn — cùng hợp đồng với cookie-pool.
function fakePool(cookies) {
  let i = 0;
  return {
    size: cookies.length,
    current: () => cookies[i] ?? null,
    rotate: () => {
      i = (i + 1) % Math.max(cookies.length, 1);
    },
  };
}

test("thành công ngay lần đầu thì không rotate", async () => {
  const used = [];
  const out = await downloadWithRetry(
    async (cookie) => {
      used.push(cookie);
      return "ok";
    },
    fakePool(["a", "b", "c"]),
  );
  assert.equal(out, "ok");
  assert.deepEqual(used, ["a"]);
});

test("bot-check thì đổi cookie kế tiếp rồi thử lại", async () => {
  const used = [];
  const out = await downloadWithRetry(async (cookie) => {
    used.push(cookie);
    if (cookie !== "c") throw new Error("Sign in to confirm you're not a bot");
    return "ok";
  }, fakePool(["a", "b", "c"]));
  assert.equal(out, "ok");
  assert.deepEqual(used, ["a", "b", "c"]);
});

// Hết cookie thì phải dừng, không quay vòng vô hạn.
test("cháy hết cookie thì ném lỗi cuối cùng", async () => {
  const used = [];
  await assert.rejects(
    () =>
      downloadWithRetry(async (cookie) => {
        used.push(cookie);
        throw new Error("Sign in to confirm you're not a bot");
      }, fakePool(["a", "b"])),
    /not a bot/,
  );
  assert.deepEqual(used, ["a", "b"]);
});

test("lỗi thường ném thẳng, KHÔNG retry", async () => {
  const used = [];
  await assert.rejects(
    () =>
      downloadWithRetry(async (cookie) => {
        used.push(cookie);
        throw new Error("Video unavailable");
      }, fakePool(["a", "b", "c"])),
    /Video unavailable/,
  );
  assert.deepEqual(used, ["a"]);
});

// Không có cookie nào vẫn phải tải được (tải trần), chỉ là không có gì để rotate.
test("pool rỗng vẫn gọi hàm tải đúng một lần với cookie null", async () => {
  const used = [];
  const out = await downloadWithRetry(async (cookie) => {
    used.push(cookie);
    return "ok";
  }, fakePool([]));
  assert.equal(out, "ok");
  assert.deepEqual(used, [null]);
});

test("pool rỗng gặp bot-check thì ném luôn, không lặp", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      downloadWithRetry(async () => {
        calls++;
        throw new Error("Sign in to confirm you're not a bot");
      }, fakePool([])),
    /not a bot/,
  );
  assert.equal(calls, 1);
});

test("gọi được khi không truyền pool", async () => {
  const out = await downloadWithRetry(async (cookie) => {
    assert.equal(cookie, null);
    return "ok";
  });
  assert.equal(out, "ok");
});
