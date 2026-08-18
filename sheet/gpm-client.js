import { chromium } from "playwright-core";

// Map profileId -> { browser } để đóng phiên cũ trước khi mở lại (tránh khoá profile).
const openedBrowsers = new Map();

// GPM bản cũ phục vụ API ở /api/v3, bản mới ở /api/v1. KHÔNG phải cùng một API
// đổi mỗi số version: khác cả tên tham số phân trang, chỗ đặt danh sách, đường
// dẫn đóng trình duyệt lẫn cách trả địa chỉ CDP. Nên mỗi bản một adapter riêng,
// app tự dò xem máy đang chạy bản nào thay vì bắt người dùng chọn.
// Tham chiếu bản mới: https://api-docs.gpmloginapp.com/
const PAGE_SIZE = 100;

const ADAPTERS = {
  // Bản cũ: danh sách nằm thẳng ở `data`; đóng bằng /profiles/close; start trả
  // sẵn `remote_debugging_address` dạng "host:port".
  v3: {
    listUrl: (host) => `http://${host}/api/v3/profiles?page=0&per_page=${PAGE_SIZE}`,
    pickList: (data) => (Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.profiles) ? data.profiles : []),
    startUrl: (host, id) => `http://${host}/api/v3/profiles/start/${id}`,
    pickAddress: (data) => data?.data?.remote_debugging_address,
    closeUrl: (host, id) => `http://${host}/api/v3/profiles/close/${id}`,
  },
  // Bản mới: tham số là `page_size` và trang đánh từ 1; danh sách nằm trong bọc
  // phân trang `data.data`; đóng bằng /profiles/stop; start chỉ trả cổng rời
  // (`remote_debugging_port`) nên phải tự ghép địa chỉ.
  v1: {
    listUrl: (host) => `http://${host}/api/v1/profiles?page=1&page_size=${PAGE_SIZE}`,
    pickList: (data) => (Array.isArray(data?.data?.data) ? data.data.data : []),
    startUrl: (host, id) => `http://${host}/api/v1/profiles/start/${id}`,
    pickAddress: (data) => {
      const port = data?.data?.remote_debugging_port;
      return port ? `127.0.0.1:${port}` : undefined;
    },
    closeUrl: (host, id) => `http://${host}/api/v1/profiles/stop/${id}`,
  },
};

// Thứ tự trong mảng cũng là thứ tự ưu tiên khi hoà điểm.
const API_VERSIONS = ["v3", "v1"];
const DEFAULT_VERSION = API_VERSIONS[0];

// Version đã chốt cho từng host, giữ trong suốt phiên chạy.
const versionByHost = new Map();

export function resetGpmVersionCache() { versionByHost.clear(); }

// Gọi endpoint liệt kê profile của MỘT version rồi chấm điểm.
// rank 2 = chắc chắn đúng version (có profile trả về), 1 = gọi được nhưng danh
// sách rỗng (không phân biệt nổi với máy chưa tạo profile nào), 0 = hỏng.
// TUYỆT ĐỐI không chấm bằng HTTP status: máy chạy bản mới vẫn trả 200 cho
// /api/v3, chỉ khác mỗi khuôn dữ liệu. Chấm bằng "bên nào bóc ra profile thật".
async function probeVersion(gpmHost, version, fetchFn) {
  try {
    const res = await fetchFn(ADAPTERS[version].listUrl(gpmHost));
    if (!res.ok) return { version, rank: 0, error: `GPM HTTP ${res.status}` };
    const data = await res.json();
    if (data?.success === false) {
      return { version, rank: 0, error: data.message || JSON.stringify(data) };
    }
    const list = ADAPTERS[version].pickList(data);
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
    const res = await fetchFn(ADAPTERS[version].listUrl(gpmHost));
    if (!res.ok) throw new Error(`GPM HTTP ${res.status}`);
    const data = await res.json();
    return toProfiles(ADAPTERS[version].pickList(data));
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
  const res = await fetchFn(ADAPTERS[version].startUrl(gpmHost, profileId));
  if (!res.ok) { forgetVersionOn404(gpmHost, res.status); throw new Error(`GPM HTTP ${res.status}`); }
  const data = await res.json();
  if (!data.success) throw new Error(`GPM error: ${JSON.stringify(data)}`);

  // Thiếu địa chỉ mà cứ trả undefined thì lỗi nổ tận connectOverCDP, lần ngược
  // rất mệt — báo ngay tại chỗ kèm nguyên văn phản hồi của GPM.
  const address = ADAPTERS[version].pickAddress(data);
  if (!address) throw new Error(`GPM (${version}) không trả địa chỉ CDP: ${JSON.stringify(data)}`);
  return address; // "127.0.0.1:port"
}

// Tắt hẳn profile: ngắt CDP rồi bảo GPM đóng tiến trình Chrome.
// browser.close() trên kết nối connectOverCDP chỉ NGẮT KẾT NỐI — Chrome vẫn sống,
// nên phải gọi API close của GPM thì mới giải phóng RAM và cho GPM sync profile.
export async function closeProfile(gpmHost, profileId, conn = {}, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  try { await conn.browser?.close(); } catch { /* CDP đã chết — kệ */ }
  openedBrowsers.delete(profileId);
  const version = await versionFor(gpmHost, fetchFn);
  const res = await fetchFn(ADAPTERS[version].closeUrl(gpmHost, profileId));
  if (!res.ok) { forgetVersionOn404(gpmHost, res.status); throw new Error(`GPM HTTP ${res.status}`); }
}

// Dọn profile TRƯỚC khi chạy: Chrome của profile có thể đang mở vì người dùng tự bấm
// trong GPM, hoặc còn sót sau lần app chết giữa chừng. Start đè lên phiên đó thì GPM trả
// địa chỉ CDP của cửa sổ cũ (đang ở tab người dùng để lại), và upload chạy trên trạng
// thái không lường trước.
//
// Khác closeProfile ở chỗ KHÔNG BAO GIỜ NÉM: "đóng cái chưa mở" là chuyện bình thường ở
// đây, không phải lỗi — caller chỉ cần biết có thật sự đóng cái gì không để chờ Chrome
// thoát hẳn rồi mới start.
export async function resetProfile(gpmHost, profileId, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;

  // Ngắt CDP mà chính app này còn giữ trước đã, rồi mới bảo GPM hạ tiến trình.
  const existing = openedBrowsers.get(profileId);
  if (existing) {
    try { await existing.browser.close(); } catch { /* CDP đã chết — kệ */ }
    openedBrowsers.delete(profileId);
  }

  try {
    const version = await versionFor(gpmHost, fetchFn);
    const res = await fetchFn(ADAPTERS[version].closeUrl(gpmHost, profileId));
    if (!res.ok) {
      forgetVersionOn404(gpmHost, res.status);
      return { ok: false, error: `GPM HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    if (data?.success === false) return { ok: false, error: data.message || "GPM từ chối đóng profile" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// Chrome cần vài giây để thoát hẳn sau lệnh đóng; start ngay có thể vớ phải tiến trình
// đang tắt dở hoặc thư mục profile còn khoá.
const PROFILE_RESET_WAIT_MS = 3000;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectOverCDPWithRetry(address, deps = {}, retries = 10, intervalMs = 1000) {
  const connect = deps.connectOverCDP || ((a) => chromium.connectOverCDP(`http://${a}`));
  const sleep = deps.sleep || defaultSleep;
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await connect(address);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`Không thể kết nối CDP tới ${address}: ${lastErr.message}`);
}

export async function connectAndOpenStudio(gpmHost, profileId, deps = {}) {
  // Đóng phiên đang mở của profile (kể cả phiên người dùng tự mở trong GPM) rồi mới start.
  await openFresh(gpmHost, profileId, deps);
  const address = await startProfile(gpmHost, profileId, deps);
  const browser = await connectOverCDPWithRetry(address, deps);
  openedBrowsers.set(profileId, { browser });

  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  return { ok: true };
}

// Dọn trước khi mở: profile có thể đang chạy vì người dùng tự bấm trong GPM, hoặc còn sót
// sau lần app chết giữa chừng. Start đè lên phiên đó thì GPM trả CDP của cửa sổ cũ và mọi
// thao tác chạy trên trạng thái không ai lường trước. Đóng hụt thì kệ — có gì đâu mà đóng.
async function openFresh(gpmHost, profileId, deps = {}) {
  const sleep = deps.sleep || defaultSleep;
  const r = await resetProfile(gpmHost, profileId, deps);
  if (!r.ok) return; // chưa mở sẵn (hoặc GPM không đóng được) — start thẳng, khỏi chờ vô ích
  deps.log?.(`Đã đóng profile ${profileId} đang mở trước khi chạy`);
  await sleep(deps.resetWaitMs ?? PROFILE_RESET_WAIT_MS);
}

// Kết nối tới profile GPM và trả về { browser, page } để tự động hoá (upload-queue dùng).
// Không mở trang sẵn — caller (uploadAndSchedule) tự goto Studio.
export async function connectProfile(gpmHost, profileId, deps = {}) {
  await openFresh(gpmHost, profileId, deps);
  const address = await startProfile(gpmHost, profileId, deps);
  const browser = await connectOverCDPWithRetry(address, deps);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { browser, page };
}
