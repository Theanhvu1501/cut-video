// I1(c) (bản vá theo review toàn nhánh 2026-08-08): render.js (tiến trình CLI riêng, không
// đi qua sheet-runner.js) phải tự kiểm preset composer bằng validatePreset TRƯỚC khi vào
// vòng lặp render — lớp phòng thủ thứ hai, độc lập với sheet-runner.js. Test này spawn
// render.js làm tiến trình con thật (đúng cách nó chạy trong sản phẩm — nhận cấu hình qua
// biến môi trường RENDER_CONFIG_JSON) vì đây là script top-level, không export hàm nào để
// gọi trực tiếp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDER_JS = path.join(REPO_ROOT, "render.js");

// cwd riêng cho mỗi lần chạy: render.js ghi currentDay.txt/render.log vào cwd hiện tại
// (đường dẫn tương đối "./..."), không muốn động vào file thật của repo.
function runRenderJs(configObj) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "render-cli-test-"));
  const res = spawnSync(process.execPath, [RENDER_JS, "1", "1"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, RENDER_CONFIG_JSON: JSON.stringify(configObj) },
    timeout: 20000,
  });
  fs.rmSync(cwd, { recursive: true, force: true });
  return res;
}

test("render.js: preset composer không hợp lệ (thiếu lớp overlay) -> exit(1), báo lỗi ra stderr TRƯỚC khi chạm thư mục overlays", () => {
  const badPreset = {
    version: 1, name: "bad",
    layers: [{ id: "bg", source: { type: "background" }, geometry: { fit: "full" } }],
  };
  const res = runRenderJs({ renderMode: "composer", preset: badPreset });
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}. stderr: ${res.stderr}`);
  assert.match(res.stderr, /Preset composer "bad" không hợp lệ/);
  assert.match(res.stderr, /đúng một lớp video gốc/);
  // Phải dừng TRƯỚC khi soi thư mục overlays — bằng chứng preset bị chặn sớm, không phải
  // chạy hỏng dở rồi mới lộ ra.
  assert.doesNotMatch(res.stdout + res.stderr, /overlays/i);
});

test("render.js: preset composer hợp lệ -> KHÔNG bị chặn ở bước kiểm (đi tiếp tới bước soi thư mục overlays)", () => {
  const okPreset = {
    version: 1, name: "good",
    layers: [
      { id: "bg", source: { type: "background" }, geometry: { fit: "full" } },
      { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  const res = runRenderJs({ renderMode: "composer", preset: okPreset });
  // Không tự dựng thư mục overlays/backgrounds thật -> nó sẽ báo "không tìm thấy overlay" và
  // thoát êm (exit 0, xem getFilesFromFolder trong render.js) chứ KHÔNG phải lỗi preset.
  assert.doesNotMatch(res.stderr, /không hợp lệ/);
});
