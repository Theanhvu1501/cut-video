// Bảo vệ bản đóng gói Windows khỏi hai lớp lỗi chỉ lộ ra sau khi build:
//
// 1. Script trong `asarUnpack` bị spawn thành tiến trình node RIÊNG, chạy từ
//    app.asar.unpacked/. Nếu nó import một thư mục không được bung ra, tiến
//    trình chết ngay khi nạp module (ERR_MODULE_NOT_FOUND).
// 2. Không thể spawn file .exe nằm trong app.asar. Đường dẫn ffmpeg/ffprobe
//    phải trỏ sang app.asar.unpacked.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toUnpackedPath } from "../sheet/render-core.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));
}

// Tìm mọi thư mục nội bộ mà một script import, dạng `from "./<dir>/..."`.
function localDirImports(source) {
  const dirs = new Set();
  for (const m of source.matchAll(/from\s+["']\.\/([^/"']+)\//g)) dirs.add(m[1]);
  return dirs;
}

// Một mục asarUnpack ("sheet/**", "bin/**") có phủ thư mục `dir` không?
function unpackCovers(asarUnpack, dir) {
  return asarUnpack.some((p) => p === dir || p.startsWith(`${dir}/`));
}

test("script được asarUnpack không import từ thư mục chưa được bung ra", () => {
  const pkg = readPkg();
  const asarUnpack = pkg.build?.asarUnpack ?? [];
  assert.ok(asarUnpack.length, "package.json phải có build.asarUnpack");

  const scripts = asarUnpack.filter((p) => p.endsWith(".js"));
  assert.ok(scripts.length, "asarUnpack phải liệt kê các script được spawn");

  const viPham = [];
  for (const script of scripts) {
    const full = path.join(REPO_ROOT, script);
    if (!fs.existsSync(full)) continue;
    for (const dir of localDirImports(fs.readFileSync(full, "utf-8"))) {
      if (!unpackCovers(asarUnpack, dir)) viPham.push(`${script} import ./${dir}/ nhưng "${dir}/**" không có trong asarUnpack`);
    }
  }

  assert.deepEqual(viPham, [], `\n${viPham.join("\n")}\n`);
});

test("toUnpackedPath đổi app.asar thành app.asar.unpacked, chỉ khi là thành phần thư mục", () => {
  assert.equal(
    toUnpackedPath("C:\\App\\resources\\app.asar\\bin\\ffprobe.exe"),
    "C:\\App\\resources\\app.asar.unpacked\\bin\\ffprobe.exe",
  );
  assert.equal(
    toUnpackedPath("/Applications/X/resources/app.asar/bin/ffmpeg"),
    "/Applications/X/resources/app.asar.unpacked/bin/ffmpeg",
  );
  // Đã unpacked rồi thì để yên (không thành app.asar.unpacked.unpacked).
  assert.equal(
    toUnpackedPath("/r/app.asar.unpacked/bin/ffmpeg"),
    "/r/app.asar.unpacked/bin/ffmpeg",
  );
  // Đường dẫn dev, không có asar.
  assert.equal(toUnpackedPath("/home/me/vid-master/bin/ffmpeg"), "/home/me/vid-master/bin/ffmpeg");
  // "app.asar" là tên file, không phải thư mục -> không đụng.
  assert.equal(toUnpackedPath("/r/app.asar"), "/r/app.asar");
});

test("resolveFfmpegPaths không bao giờ trả đường dẫn nằm trong app.asar", async () => {
  const { resolveFfmpegPaths } = await import("../sheet/render-core.js");
  const { ffmpegPath, ffprobePath } = resolveFfmpegPaths();
  for (const p of [ffmpegPath, ffprobePath]) {
    assert.ok(!/[\\/]app\.asar[\\/]/.test(p), `không được spawn từ trong asar: ${p}`);
  }
});
