// Chuẩn hoá chuỗi proxy người dùng nhập thành URL yt-dlp hiểu được.
// Chấp nhận: scheme://[user:pass@]host:port, host:port, host:port:user:pass.
// Thiếu scheme -> mặc định http. Ném Error nếu không parse được — KHÔNG bao giờ
// trả null, vì im lặng bỏ qua proxy đồng nghĩa tải bằng IP thật.

const SCHEMES = new Set(["http", "https", "socks5", "socks5h"]);

function validPort(p) {
  if (!/^\d+$/.test(String(p ?? ""))) return false;
  const n = Number(p);
  return n >= 1 && n <= 65535;
}

export function normalizeProxy(raw) {
  const input = String(raw ?? "").trim();
  if (!input) throw new Error("Proxy không hợp lệ: chuỗi rỗng");

  let scheme = "http";
  let rest = input;
  const m = input.match(/^([A-Za-z0-9]+):\/\/(.*)$/);
  if (m) {
    scheme = m[1].toLowerCase();
    rest = m[2];
    if (!SCHEMES.has(scheme)) throw new Error(`Proxy không hợp lệ: scheme "${scheme}" không hỗ trợ`);
  }

  // Đã có dạng user:pass@host:port
  const at = rest.lastIndexOf("@");
  if (at !== -1) {
    const auth = rest.slice(0, at);
    const hostPortParts = rest.slice(at + 1).split(":");
    if (hostPortParts.length !== 2) throw new Error(`Proxy không hợp lệ: ${input}`);
    const [host, port] = hostPortParts;
    if (!auth || !host || !validPort(port)) throw new Error(`Proxy không hợp lệ: ${input}`);
    return `${scheme}://${auth}@${host}:${port}`;
  }

  const parts = rest.split(":");
  if (parts.length === 2) {
    const [host, port] = parts;
    if (!host || !validPort(port)) throw new Error(`Proxy không hợp lệ: ${input}`);
    return `${scheme}://${host}:${port}`;
  }
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    if (!host || !validPort(port) || !user || !pass) throw new Error(`Proxy không hợp lệ: ${input}`);
    return `${scheme}://${user}:${pass}@${host}:${port}`;
  }
  throw new Error(`Proxy không hợp lệ: ${input}`);
}
