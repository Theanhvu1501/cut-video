// Trạng thái resume, tách khỏi runner-state.json (vốn chỉ giữ quota theo ngày).
// Khoá theo sheetName -> videoId. Giữ đường dẫn file và số lần thử — thứ Sheet
// không tiện chứa. Mất file này chỉ làm hệ thống chậm lại, không làm nó sai.

import fs from "fs";
import path from "path";
import { videoIdOf } from "./youtube-api.js";

export function keyOf(url) {
  return videoIdOf(url) || String(url ?? "").trim();
}

export function loadResume(statePath) {
  try {
    if (!fs.existsSync(statePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveResume(statePath, state) {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export function getEntry(state, sheetName, url) {
  return state?.[sheetName]?.[keyOf(url)] ?? null;
}

export function setEntry(state, sheetName, url, patch) {
  const k = keyOf(url);
  if (!state[sheetName]) state[sheetName] = {};
  const prev = state[sheetName][k] || { attempts: 0, uploadAttempts: 0 };
  state[sheetName][k] = { ...prev, ...patch };
  return state[sheetName][k];
}

export function clearEntry(state, sheetName, url) {
  const k = keyOf(url);
  const ch = state[sheetName];
  if (!ch) return;
  delete ch[k];
  if (!Object.keys(ch).length) delete state[sheetName];
}
