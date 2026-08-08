import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  listPresets, loadPreset, savePreset, ensureBuiltins, applySlotOverrides,
} from "../sheet/preset-store.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vm-presets-"));

const p1 = {
  version: 1, name: "thu",
  layers: [
    { id: "bg", source: { type: "background" }, geometry: { fit: "full" } },
    { id: "k", slot: "khung", source: { type: "image", path: "mac-dinh.png" }, geometry: { fit: "full" } },
    { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } },
  ],
};

test("savePreset rồi loadPreset trả lại đúng preset", () => {
  const dir = tmp();
  assert.deepEqual(savePreset(dir, p1), { ok: true, errors: [] });
  assert.deepEqual(loadPreset(dir, "thu"), p1);
});

test("savePreset từ chối preset không hợp lệ và KHÔNG ghi file", () => {
  const dir = tmp();
  const bad = { version: 1, name: "xau", layers: [{ id: "a", source: { type: "background" } }] };
  const r = savePreset(dir, bad);
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(path.join(dir, "xau.json")), false);
});

test("savePreset tạo thư mục nếu chưa có", () => {
  const dir = path.join(tmp(), "chua-ton-tai");
  assert.equal(savePreset(dir, p1).ok, true);
  assert.ok(fs.existsSync(path.join(dir, "thu.json")));
});

test("savePreset làm sạch tên file, chặn đi ra ngoài thư mục", () => {
  const dir = tmp();
  assert.equal(savePreset(dir, { ...p1, name: "../../hack" }).ok, true);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.doesNotMatch(files[0], /\.\./);
});

test("listPresets trả tên đã sắp, bỏ file không phải .json", () => {
  const dir = tmp();
  savePreset(dir, { ...p1, name: "beta" });
  savePreset(dir, { ...p1, name: "alpha" });
  fs.writeFileSync(path.join(dir, "ghi-chu.txt"), "x");
  assert.deepEqual(listPresets(dir), ["alpha", "beta"]);
});

test("listPresets trả mảng rỗng khi thư mục chưa tồn tại", () => {
  assert.deepEqual(listPresets(path.join(tmp(), "khong-co")), []);
});

test("loadPreset trả null khi không có file, và khi JSON hỏng", () => {
  const dir = tmp();
  assert.equal(loadPreset(dir, "khong-co"), null);
  fs.writeFileSync(path.join(dir, "hong.json"), "{ khong phai json");
  assert.equal(loadPreset(dir, "hong"), null);
});

test("ensureBuiltins copy preset dựng sẵn lần đầu", () => {
  const src = tmp();
  const dst = tmp();
  fs.writeFileSync(path.join(src, "a.json"), JSON.stringify(p1));
  assert.deepEqual(ensureBuiltins(dst, src).copied, ["a"]);
  assert.ok(fs.existsSync(path.join(dst, "a.json")));
});

test("ensureBuiltins KHÔNG ghi đè bản người dùng đã sửa", () => {
  const src = tmp();
  const dst = tmp();
  fs.writeFileSync(path.join(src, "a.json"), JSON.stringify(p1));
  fs.writeFileSync(path.join(dst, "a.json"), JSON.stringify({ ...p1, name: "da-sua" }));
  assert.deepEqual(ensureBuiltins(dst, src).copied, []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dst, "a.json"), "utf8")).name, "da-sua");
});

test("applySlotOverrides ghi đè đúng khe, để trống thì giữ mặc định", () => {
  const r = applySlotOverrides(p1, { khung: "D:/kenh-b/hoa.png" });
  assert.equal(r.layers.find((l) => l.slot === "khung").source.path, "D:/kenh-b/hoa.png");
  const r2 = applySlotOverrides(p1, { khung: "" });
  assert.equal(r2.layers.find((l) => l.slot === "khung").source.path, "mac-dinh.png");
});

test("applySlotOverrides KHÔNG sửa preset gốc", () => {
  applySlotOverrides(p1, { khung: "khac.png" });
  assert.equal(p1.layers.find((l) => l.slot === "khung").source.path, "mac-dinh.png");
});

test("applySlotOverrides bỏ qua khe không tồn tại, không ném", () => {
  assert.doesNotThrow(() => applySlotOverrides(p1, { khong_co_khe: "x.png" }));
});

test("savePreset từ chối khi tên khác nhưng trùng chỗ lưu, KHÔNG xoá preset cũ", () => {
  const dir = tmp();
  assert.equal(savePreset(dir, { ...p1, name: "foo-bar" }).ok, true);
  const r = savePreset(dir, { ...p1, name: "foo/bar" });
  assert.equal(r.ok, false);
  assert.match(r.errors.join("|"), /trùng chỗ lưu/);
  // Preset cũ phải còn nguyên.
  assert.equal(loadPreset(dir, "foo-bar").name, "foo-bar");
});

test("savePreset vẫn cho lưu đè chính preset đó", () => {
  const dir = tmp();
  savePreset(dir, { ...p1, name: "thu" });
  const again = savePreset(dir, { ...p1, name: "thu", version: 2 });
  assert.equal(again.ok, true);
  assert.equal(loadPreset(dir, "thu").version, 2);
});

test("savePreset cho ghi đè khi file cũ hỏng, không phải preset", () => {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "thu.json"), "42");
  assert.equal(savePreset(dir, { ...p1, name: "thu" }).ok, true);
});

test("loadPreset trả null khi JSON parse được nhưng không phải object preset", () => {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of [["mang", "[]"], ["so", "42"], ["rong", "null"]]) {
    fs.writeFileSync(path.join(dir, `${name}.json`), body);
    assert.equal(loadPreset(dir, name), null, `${name} phải trả null`);
  }
});

test("ensureBuiltins hỏng một file thì vẫn copy những file còn lại và có cảnh báo", () => {
  const src = tmp();
  const dst = tmp();
  fs.writeFileSync(path.join(src, "a.json"), JSON.stringify(p1));
  fs.writeFileSync(path.join(src, "b.json"), JSON.stringify(p1));
  // Chặn đường ghi của b bằng một THƯ MỤC cùng tên -> copyFileSync ném EISDIR/EPERM.
  fs.mkdirSync(path.join(dst, "b.json"), { recursive: true });
  const r = ensureBuiltins(dst, src);
  assert.deepEqual(r.copied, ["a"]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /b\.json/);
});

test("ensureBuiltins thiếu thư mục dựng sẵn thì có cảnh báo, không ném", () => {
  const dst = tmp();
  let r;
  assert.doesNotThrow(() => { r = ensureBuiltins(dst, path.join(tmp(), "khong-co")); });
  assert.deepEqual(r.copied, []);
  assert.equal(r.warnings.length, 1);
});

test("ensureBuiltins KHÔNG ghi đè file hỏng, nhưng có cảnh báo", () => {
  const src = tmp();
  const dst = tmp();
  fs.writeFileSync(path.join(src, "a.json"), JSON.stringify(p1));
  // Bản người dùng đã sửa rồi lỡ làm hỏng — nội dung đó vẫn phải còn nguyên.
  fs.writeFileSync(path.join(dst, "a.json"), "{ thieu dau ngoac");
  const r = ensureBuiltins(dst, src);
  assert.deepEqual(r.copied, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /đọc không được/);
  // Quan trọng nhất: nội dung cũ KHÔNG bị thay.
  assert.equal(fs.readFileSync(path.join(dst, "a.json"), "utf8"), "{ thieu dau ngoac");
});
