import { test } from "node:test";
import assert from "node:assert/strict";
import { captureContentPage } from "../sheet/yt-capture.js";

// page giả: ghi lại mọi URL đã goto, trả url() theo kịch bản.
function fakePage({ url = "https://studio.youtube.com/channel/UC123", waitThrows = false } = {}) {
  const gotos = [];
  let shots = 0;
  return {
    gotos,
    get shots() { return shots; },
    goto: async (u) => { gotos.push(u); },
    url: () => url,
    waitForSelector: async () => { if (waitThrows) throw new Error("timeout"); },
    screenshot: async () => { shots++; return Buffer.from("PNG"); },
  };
}

const noSleep = async () => {};

test("captureContentPage: vào Studio, lấy channel ID, chụp trang Nội dung", async () => {
  const page = fakePage();
  const buf = await captureContentPage(page, { sleep: noSleep });
  assert.equal(page.gotos[0], "https://studio.youtube.com");
  assert.equal(page.gotos[1], "https://studio.youtube.com/channel/UC123/videos/upload");
  assert.equal(page.gotos.length, 2);
  assert.equal(buf.toString(), "PNG");
});

test("captureContentPage: chưa login (URL không có /channel/) -> ném lỗi, không chụp", async () => {
  const page = fakePage({ url: "https://accounts.google.com/signin" });
  await assert.rejects(
    () => captureContentPage(page, { sleep: noSleep }),
    /channel ID/,
  );
  assert.equal(page.shots, 0, "chưa login thì không được chụp");
});

test("captureContentPage: không thấy dòng video nào vẫn chụp và vẫn trả ảnh", async () => {
  const page = fakePage({ waitThrows: true });
  const logs = [];
  const buf = await captureContentPage(page, { sleep: noSleep, log: (m) => logs.push(m) });
  assert.equal(buf.toString(), "PNG");
  assert.equal(page.shots, 1);
  assert.ok(logs.some((m) => /không thấy dòng video/.test(m)));
});

test("captureContentPage: chờ settleMs trước khi chụp (ảnh thumbnail lazy-load)", async () => {
  const page = fakePage();
  const slept = [];
  await captureContentPage(page, { settleMs: 7000, sleep: async (ms) => { slept.push(ms); } });
  assert.deepEqual(slept, [7000]);
});
