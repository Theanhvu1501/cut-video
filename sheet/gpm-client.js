import { chromium } from "playwright-core";

// Map profileId -> { browser } để đóng phiên cũ trước khi mở lại (tránh khoá profile).
const openedBrowsers = new Map();

// GPM bản cũ phục vụ API ở /api/v3, bản mới ở /api/v1. Đường dẫn và dữ liệu trả
// về giống hệt nhau, chỉ khác mỗi đoạn version — nên app tự dò thay vì bắt người
// dùng chọn. Thứ tự trong mảng cũng là thứ tự ưu tiên khi hoà điểm.
const API_VERSIONS = ["v3", "v1"];
const DEFAULT_VERSION = API_VERSIONS[0];

// Version đã chốt cho từng host, giữ trong suốt phiên chạy.
const versionByHost = new Map();

export function resetGpmVersionCache() { versionByHost.clear(); }

// Gọi endpoint liệt kê profile của MỘT version rồi chấm điểm.
// rank 2 = chắc chắn đúng version (có profile trả về), 1 = gọi được nhưng danh
// sách rỗng (không phân biệt nổi với máy chưa tạo profile nào), 0 = hỏng.
// Sai version có thể là 404, mà cũng có thể là 200 kèm data rỗng — nên không
// được chấm bằng mỗi HTTP status.
async function probeVersion(gpmHost, version, fetchFn) {
  try {
    const res = await fetchFn(`http://${gpmHost}/api/${version}/profiles?page=0&per_page=100`);
    if (!res.ok) return { version, rank: 0, error: `GPM HTTP ${res.status}` };
    const data = await res.json();
    if (data?.success === false) {
      return { version, rank: 0, error: data.message || JSON.stringify(data) };
    }
    const list = Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.profiles) ? data.profiles : [];
    return { version, rank: list.length ? 2 : 1, list };
  } catch (err) {
    return { version, rank: 0, error: String(err?.message || err) };
  }
}

// Dò song song cả hai version (đều là localhost) rồi lấy bên điểm cao nhất.
// CHỈ nhớ khi chắc chắn: máy chưa có profile nào thì cả hai cùng mơ hồ, chốt vội
// là sai vĩnh viễn cho cả phiên — cứ để lần sau dò lại.
async function detectVersion(gpmHost, fetchFn) {
  const cached = versionByHost.get(gpmHost);
  if (cached) return { version: cached, cached: true };

  const probes = await Promise.all(API_VERSIONS.map((v) => probeVersion(gpmHost, v, fetchFn)));
  const best = probes.reduce((a, b) => (b.rank > a.rank ? b : a));
  if (best.rank === 2) versionByHost.set(gpmHost, best.version);
  return { version: best.rank ? best.version : DEFAULT_VERSION, best, probes };
}

// Dùng cho start/close: dò được thì tốt, không thì cứ v3 và để lời gọi thật báo
// lỗi. Không kết nối được GPM là chuyện của lời gọi đó, đừng biến thành lỗi dò.
async function versionFor(gpmHost, fetchFn) {
  return versionByHost.get(gpmHost) || (await detectVersion(gpmHost, fetchFn)).version;
}

// 404 ở start/close: có thể profile ID sai, mà cũng có thể người dùng vừa nâng
// cấp GPM giữa phiên. Xoá cache cho lần sau dò lại, khỏi phải khởi động lại app.
function forgetVersionOn404(gpmHost, status) {
  if (status === 404) versionByHost.delete(gpmHost);
}

export async function testGpmConnection(gpmHost, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const { version, best, cached } = await detectVersion(gpmHost, fetchFn);

  // Đã có version trong cache thì gọi thẳng, khỏi dò lại.
  if (cached) {
    const res = await fetchFn(`http://${gpmHost}/api/${version}/profiles?page=0&per_page=100`);
    if (!res.ok) throw new Error(`GPM HTTP ${res.status}`);
    const data = await res.json();
    return toProfiles(data.data || data.profiles || []);
  }

  // Cả hai version đều hỏng: báo nguyên văn lỗi của version ưu tiên. GPM chưa bật
  // thì lỗi là "không kết nối được", đừng đổ cho version.
  if (!best.rank) throw new Error(best.error || "không gọi được GPM");
  return toProfiles(best.list);
}

const toProfiles = (list) => list.map((p) => ({ id: p.id, name: p.name || p.id }));

// Version đã chốt cho host, để UI hiện ra — nhiều máy mỗi máy một bản GPM, nhìn
// phát biết ngay. undefined khi chưa dò chắc chắn (máy chưa có profile nào).
export function getGpmApiVersion(gpmHost) { return versionByHost.get(gpmHost); }

export async function startProfile(gpmHost, profileId, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const version = await versionFor(gpmHost, fetchFn);
  const res = await fetchFn(`http://${gpmHost}/api/${version}/profiles/start/${profileId}`);
  if (!res.ok) { forgetVersionOn404(gpmHost, res.status); throw new Error(`GPM HTTP ${res.status}`); }
  const data = await res.json();
  if (!data.success) throw new Error(`GPM error: ${JSON.stringify(data)}`);
  return data.data.remote_debugging_address; // "127.0.0.1:port"
}

// Tắt hẳn profile: ngắt CDP rồi bảo GPM đóng tiến trình Chrome.
// browser.close() trên kết nối connectOverCDP chỉ NGẮT KẾT NỐI — Chrome vẫn sống,
// nên phải gọi API close của GPM thì mới giải phóng RAM và cho GPM sync profile.
export async function closeProfile(gpmHost, profileId, conn = {}, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  try { await conn.browser?.close(); } catch { /* CDP đã chết — kệ */ }
  openedBrowsers.delete(profileId);
  const version = await versionFor(gpmHost, fetchFn);
  const res = await fetchFn(`http://${gpmHost}/api/${version}/profiles/close/${profileId}`);
  if (!res.ok) { forgetVersionOn404(gpmHost, res.status); throw new Error(`GPM HTTP ${res.status}`); }
}

async function connectOverCDPWithRetry(address, retries = 10, intervalMs = 1000) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await chromium.connectOverCDP(`http://${address}`);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`Không thể kết nối CDP tới ${address}: ${lastErr.message}`);
}

export async function connectAndOpenStudio(gpmHost, profileId) {
  // Đóng phiên cũ của cùng profile nếu có (tránh khoá thư mục profile).
  const existing = openedBrowsers.get(profileId);
  if (existing) {
    try { await existing.browser.close(); } catch {}
    openedBrowsers.delete(profileId);
  }

  const address = await startProfile(gpmHost, profileId);
  const browser = await connectOverCDPWithRetry(address);
  openedBrowsers.set(profileId, { browser });

  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  return { ok: true };
}

// Kết nối tới profile GPM và trả về { browser, page } để tự động hoá (upload-queue dùng).
// Không mở trang sẵn — caller (uploadAndSchedule) tự goto Studio.
export async function connectProfile(gpmHost, profileId) {
  const address = await startProfile(gpmHost, profileId);
  const browser = await connectOverCDPWithRetry(address);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { browser, page };
}
