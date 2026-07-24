// Chụp trang Nội dung của YouTube Studio bằng page GPM đang mở (CDP).
// Dùng để gửi bằng chứng hình ảnh vào Telegram: thumbnail thật YouTube đang
// phục vụ + cột "Đã lên lịch" của loạt video vừa đăng.

const STUDIO = "https://studio.youtube.com";

/**
 * @param {import('playwright-core').Page} page - page từ trình duyệt GPM.
 * @param {object} [opts]
 * @param {number} [opts.settleMs=5000] - chờ ảnh thumbnail lazy-load xong mới chụp.
 * @param {number} [opts.timeoutMs=60000] - timeout cho mỗi lần điều hướng.
 * @returns {Promise<Buffer>} ảnh PNG của viewport.
 */
export async function captureContentPage(page, {
  settleMs = 5000,
  timeoutMs = 60_000,
  log = () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  // studio.youtube.com chuyển hướng về /channel/<ID> của profile đang đăng nhập —
  // đọc URL là cách duy nhất biết channel ID mà không phải gọi API YouTube.
  await page.goto(STUDIO, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const m = /\/channel\/([^/?#]+)/.exec(page.url());
  if (!m) throw new Error(`Không lấy được channel ID từ URL Studio (${page.url()}) — có thể chưa login.`);

  await page.goto(`${STUDIO}/channel/${m[1]}/videos/upload`, {
    waitUntil: "domcontentloaded", timeout: timeoutMs,
  });

  // Selector hỏng (YouTube đổi giao diện) KHÔNG được chặn — ảnh trang lạ cũng là thông tin.
  try {
    await page.waitForSelector("ytcp-video-row", { timeout: 20_000 });
  } catch {
    log("   … không thấy dòng video nào trên trang Nội dung — vẫn chụp");
  }
  await sleep(settleMs);

  // Viewport, KHÔNG fullPage: connectOverCDP cho context viewport:null nên không đổi
  // được kích thước; fullPage sẽ ra ảnh cao 30 dòng và bị Telegram nén thành không đọc nổi.
  return await page.screenshot({ type: "png" });
}
