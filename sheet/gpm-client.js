import { chromium } from "playwright-core";

// Map profileId -> { browser } để đóng phiên cũ trước khi mở lại (tránh khoá profile).
const openedBrowsers = new Map();

export async function testGpmConnection(gpmHost, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const res = await fetchFn(`http://${gpmHost}/api/v3/profiles?page=0&per_page=100`);
  if (!res.ok) throw new Error(`GPM HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || data.profiles || []).map((p) => ({ id: p.id, name: p.name || p.id }));
}

export async function startProfile(gpmHost, profileId, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const res = await fetchFn(`http://${gpmHost}/api/v3/profiles/start/${profileId}`);
  if (!res.ok) throw new Error(`GPM HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`GPM error: ${JSON.stringify(data)}`);
  return data.data.remote_debugging_address; // "127.0.0.1:port"
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
