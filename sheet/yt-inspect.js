// Script DÒ SELECTOR thật trên YouTube Studio, chạy qua trình duyệt GPM đã login.
// Mục đích: lấy selector đúng với UI của BẠN (không đoán mò), để điền vào SEL trong yt-upload.js.
//
// Cách dùng (chạy trong thư mục dự án, GPM Login đang mở):
//   node sheet/yt-inspect.js <gpmHost> <profileId>
//   ví dụ: node sheet/yt-inspect.js 127.0.0.1:19995 abc123
//
// Sau khi chạy: trình duyệt GPM mở YouTube Studio.
//   - Bạn tự bấm qua từng bước (Tạo → Tải lên → điền chi tiết → Hiển thị…).
//   - Ở MỖI màn hình, quay lại terminal nhấn ENTER → nó in ra mọi nút/ô đang hiện + selector.
//   - Gõ  q  rồi Enter để thoát.

import { chromium } from "playwright-core";
import { startProfile } from "./gpm-client.js";
import readline from "readline";

const gpmHost = process.argv[2] || "127.0.0.1:19995";
const profileId = process.argv[3];

if (!profileId) {
  console.error("Thiếu profileId. Dùng: node sheet/yt-inspect.js <gpmHost> <profileId>");
  process.exit(1);
}

console.log(`Đang mở profile GPM ${profileId} qua ${gpmHost}…`);
const address = await startProfile(gpmHost, profileId);
const browser = await chromium.connectOverCDP(`http://${address}`);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: 60_000 });

// In ra mọi element tương tác ĐANG HIỆN trên màn hình + selector gợi ý.
async function dump() {
  const items = await page.evaluate(() => {
    const SELS = [
      "button", "ytcp-button", "tp-yt-paper-item", "tp-yt-paper-radio-button",
      "input", "textarea", "[contenteditable=true]", "[test-id]", "[aria-label]",
    ];
    const seen = new Set();
    const out = [];
    for (const s of SELS) {
      for (const el of document.querySelectorAll(s)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue; // chỉ lấy element đang hiển thị
        out.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || "",
          testId: el.getAttribute("test-id") || "",
          name: el.getAttribute("name") || "",
          aria: (el.getAttribute("aria-label") || "").replace(/\s+/g, " ").slice(0, 50),
          text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        });
      }
    }
    return out;
  });

  console.log(`\n===== ${items.length} element đang hiện =====`);
  for (const it of items) {
    // Gợi ý selector ưu tiên: #id > [test-id] > [name] > [aria-label]
    let sel = "";
    if (it.id) sel = `#${it.id}`;
    else if (it.testId) sel = `[test-id="${it.testId}"]`;
    else if (it.name) sel = `[name="${it.name}"]`;
    else if (it.aria) sel = `[aria-label="${it.aria}"]`;
    console.log(`${it.tag.padEnd(24)} ${sel.padEnd(40)} » ${it.text || it.aria}`);
  }
  console.log("(Nhấn Enter để in lại sau khi chuyển bước, hoặc gõ q để thoát)");
}

await dump();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("\n>>> Điều hướng trong trình duyệt GPM. Về đây nhấn ENTER để dò lại. Gõ q để thoát.");
rl.on("line", async (line) => {
  if (line.trim().toLowerCase() === "q") {
    rl.close();
    process.exit(0); // không đóng browser GPM
  }
  try {
    await dump();
  } catch (e) {
    console.error("Lỗi dò:", e.message);
  }
});
