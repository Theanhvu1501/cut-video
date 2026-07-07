import fs from "fs";
import path from "path";

export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shouldResetQuota(channelState, today) {
  if (!channelState) return true;
  return channelState.lastRunDate !== today;
}

export function computeRemaining(channelState, videosPerDay, today) {
  const n = parseInt(videosPerDay, 10) || 0;
  const count = shouldResetQuota(channelState, today) ? 0 : (channelState.countToday || 0);
  return Math.max(0, n - count);
}

export function recordRendered(state, sheetName, today) {
  const cur = state[sheetName];
  if (!cur || cur.lastRunDate !== today) {
    state[sheetName] = { lastRunDate: today, countToday: 1 };
  } else {
    cur.countToday = (cur.countToday || 0) + 1;
  }
}

export function loadState(statePath) {
  try {
    if (!fs.existsSync(statePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveState(statePath, state) {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}
