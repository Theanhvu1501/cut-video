// Vòng đời server bgutil sinh PO token.
//
// YouTube yêu cầu proof-of-origin token cho phần lớn format từ 2025. Thiếu nó thì
// hoặc bị chặn thẳng ("Sign in to confirm you're not a bot"), hoặc âm thầm tụt
// xuống một format rác — đo trên máy này: có PO token ra 2160p (401+251), không có
// mà lại ép player_client=android thì ra đúng format 18 (360p).
//
// Chạy server HTTP thay vì script mode vì server cache token trong RAM, không phải
// trả giá khởi động node + jsdom (~2-5s) cho mỗi lần xin token. Cả ba file plugin
// được chép cùng lúc nên script mode tự động thành đường lùi: server chết hoặc chạy
// download.js thẳng từ CLI (Electron không bật) thì yt-dlp tụt xuống bgutil:script.

import { spawn as nodeSpawn } from "child_process";
import path from "path";

export const DEFAULT_POT_PORT = 4416;

export function potBaseUrl(port) {
  return `http://127.0.0.1:${port}`;
}

async function defaultPing(baseUrl, timeoutMs = 2000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/ping`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`ping ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// /ping của bgutil luôn có server_uptime. Kiểm tra khoá này để không nhận nhầm một
// dịch vụ khác đang chiếm cổng 4416 rồi tưởng đã có PO token.
const looksLikeBgutil = (info) => !!info && info.server_uptime !== undefined;

/**
 * Trả { port, baseUrl, reused, stop() } hoặc null nếu không dựng được.
 *
 * KHÔNG ném lỗi khi thất bại: thiếu PO token thì tải vẫn chạy (chậm hơn, dễ dính
 * bot-check hơn), còn ném ở đây là chặn luôn cả app không cho tải gì.
 */
export async function startPotServer({
  nodePath,
  serverDir,
  port = DEFAULT_POT_PORT,
  portsToTry = 3,
  attempts = 30,
  intervalMs = 1000,
  spawnFn = nodeSpawn,
  pingFn = defaultPing,
  sleepFn = defaultSleep,
  log = () => {},
} = {}) {
  if (!nodePath || !serverDir) return null;

  for (let offset = 0; offset < portsToTry; offset++) {
    const tryPort = port + offset;
    const baseUrl = potBaseUrl(tryPort);

    // Đã có server sẵn (bản portable đang mở, hoặc phiên trước chưa tắt) thì DÙNG
    // LẠI. Spawn thêm chỉ tốn RAM và cái mới sẽ chết vì cổng bận.
    try {
      const info = await pingFn(baseUrl);
      if (looksLikeBgutil(info)) {
        log(`bgutil đã chạy sẵn ở ${baseUrl} (v${info.version ?? "?"})`);
        return { port: tryPort, baseUrl, reused: true, stop: async () => {} };
      }
    } catch {
      // Chưa có ai ở cổng này -> tự dựng.
    }

    const script = path.join(serverDir, "build", "main.js");
    const child = spawnFn(nodePath, [script, "--port", String(tryPort)], {
      cwd: serverDir,
      windowsHide: true,
      stdio: "ignore",
    });

    // Cổng bị một app khác (không phải bgutil) chiếm -> tiến trình con chết ngay vì
    // EADDRINUSE. Bắt sự kiện để nhảy sang cổng kế tiếp thay vì ping tới hết giờ.
    let exited = false;
    child.on?.("exit", () => {
      exited = true;
    });
    child.on?.("error", () => {
      exited = true;
    });

    for (let i = 0; i < attempts; i++) {
      if (exited) break;
      try {
        const info = await pingFn(baseUrl);
        if (looksLikeBgutil(info)) {
          log(`bgutil server sẵn sàng ở ${baseUrl} (v${info.version ?? "?"})`);
          return {
            port: tryPort,
            baseUrl,
            reused: false,
            stop: async () => {
              try {
                child.kill();
              } catch {
                // Đã chết rồi thì thôi.
              }
            },
          };
        }
      } catch {
        // Chưa lên, đợi tiếp.
      }
      await sleepFn(intervalMs);
    }

    try {
      child.kill();
    } catch {
      // Đã chết rồi thì thôi.
    }
  }

  log("Không khởi động được bgutil server — yt-dlp sẽ tự lùi sang script mode");
  return null;
}
