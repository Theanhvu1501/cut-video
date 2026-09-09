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
import { jsRuntimeArg } from "../sheet/download-options.js";

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

// 3. electron-builder tự chèn luật "!**/node_modules" loại MỌI node_modules lồng
//    nhau (nó dựng cây phụ thuộc riêng từ package.json gốc). bgutil mang theo
//    node_modules của chính nó (262 gói: express, jsdom, youtubei.js, canvas...),
//    nên nếu đi đường `files` thì build ra chỉ còn main.js trần -> server PO token
//    không khởi động được -> YouTube chặn bot trở lại.
//
//    Lỗi này IM LẶNG: build thành công, app mở bình thường, chỉ có tải là hỏng.
//    Đã đo trên bản build thật: qua `files` còn 0 gói / 424KB, qua `extraResources`
//    đủ 262 gói / 173MB.
test("bgutil phải đi đường extraResources, không qua files", () => {
  const pkg = readPkg();
  const extra = pkg.build?.extraResources ?? [];

  const entry = extra.find((e) => (typeof e === "string" ? e : e?.from) === "bin/bgutil");
  assert.ok(
    entry,
    "build.extraResources phải chép bin/bgutil, nếu không node_modules của nó bị lột sạch",
  );
  assert.equal(entry.to, "bgutil", "phải rơi vào resources/bgutil — getBgutilPaths tìm ở '../bgutil'");

  // Không để bản cụt lọt qua `files` nữa: hai bản bgutil trong cùng một build thì
  // getBgutilPaths có thể vớ phải bản không có node_modules.
  const files = pkg.build?.files ?? [];
  assert.ok(
    files.includes("!bin/bgutil/**"),
    "build.files phải loại bin/bgutil để không ship kèm bản đã bị lột node_modules",
  );
});

// 4. --js-runtime nhận dạng RUNTIME[:PATH] và yt-dlp cắt ở dấu ":" ĐẦU TIÊN. Truyền
//    đường dẫn trần "C:\...\node.exe" thì ổ đĩa thành tên runtime:
//      WARNING: Ignoring unsupported JavaScript runtime(s): c
//      [jsc] JS Challenge Providers: ... node (unavailable)
//    Mất JS runtime thì YouTube trả về format cụt rồi chặn bot.
//
//    Bẫy ở chỗ lỗi này VÔ HÌNH khi chạy dev: getNodeExecutable trả về "node" (không
//    có dấu ":") nên chỉ bản đóng gói mới dính — đúng loại lỗi file test này sinh ra
//    để chặn. Trước đây download.js giữ một bản getNodeExecutable nhân bản và truyền
//    thẳng kết quả, nên khi bản dùng chung được sửa thì nó bị bỏ quên.
test("script spawn riêng phải bọc jsRuntimeArg quanh đường dẫn node", () => {
  const pkg = readPkg();
  const scripts = (pkg.build?.asarUnpack ?? []).filter((p) => p.endsWith(".js"));

  const viPham = [];
  for (const script of scripts) {
    const full = path.join(REPO_ROOT, script);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf-8");

    for (const m of src.matchAll(/jsRuntime:\s*([^,\n]+)/g)) {
      const value = m[1].trim();
      if (!value.includes("jsRuntimeArg(")) viPham.push(`${script}: jsRuntime: ${value}`);
    }
  }

  assert.deepEqual(
    viPham,
    [],
    `phải bọc jsRuntimeArg() để yt-dlp không đọc ổ đĩa thành tên runtime:\n${viPham.join("\n")}`,
  );
});

// Ổ C: là ca thật đã gặp trên máy người dùng (app cài vào Program Files).
test("jsRuntimeArg xử lý đúng đường dẫn ổ C: của bản cài đặt", () => {
  assert.equal(
    jsRuntimeArg("C:\\Program Files\\VidMaster\\resources\\app.asar.unpacked\\bin\\node.exe"),
    "node:C:\\Program Files\\VidMaster\\resources\\app.asar.unpacked\\bin\\node.exe",
  );
});
