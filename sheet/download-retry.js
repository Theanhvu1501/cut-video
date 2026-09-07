// Retry khi dính bot-check, dùng chung cho tải thủ công (download.js) và tải theo
// Sheet (sheet/channel-download.js).
//
// CHỈ retry lỗi bot-check. Lỗi mạng, "Video unavailable", hết dung lượng đĩa... mà
// đổi cookie thử lại thì vừa tốn thời gian vừa giấu mất nguyên nhân thật: người
// dùng thấy app thử 7 lần rồi mới báo lỗi, tưởng cookie hỏng trong khi thực ra
// video bị gỡ.

import { isBotCheckError } from "./cookie-pool.js";

// fn nhận đường dẫn cookie đang dùng (hoặc null nếu không có cookie nào) và tự
// dựng lời gọi yt-dlp. Số lần thử tối đa = số cookie trong pool: đã đi hết một
// vòng mà vẫn bị chặn thì thử tiếp cũng chỉ lặp lại đúng các cookie đó.
export async function downloadWithRetry(fn, pool = null, { onRotate = null } = {}) {
  const attempts = Math.max(1, pool?.size ?? 0);
  let lastErr = null;

  for (let i = 0; i < attempts; i++) {
    const cookie = pool?.current?.() ?? null;
    try {
      return await fn(cookie);
    } catch (err) {
      if (!isBotCheckError(err)) throw err;
      lastErr = err;
      if (i < attempts - 1) {
        pool.rotate();
        onRotate?.({ from: cookie, to: pool.current(), attempt: i + 1, total: attempts });
      }
    }
  }

  throw lastErr;
}
