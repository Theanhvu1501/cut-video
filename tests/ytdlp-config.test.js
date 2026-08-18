import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_EXTRACTOR_ARGS,
  parseExtractorArgs,
  loadYtdlpSettings,
  saveYtdlpSettings,
} from "../sheet/ytdlp-config.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ytcfg-"));
}

test("mặc định là player_client=web_embedded", () => {
  assert.equal(DEFAULT_EXTRACTOR_ARGS, "youtube:player_client=web_embedded");
});

test("parseExtractorArgs: một dòng -> mảng một phần tử, giữ nguyên dấu : = ,", () => {
  assert.deepEqual(
    parseExtractorArgs("youtube:player_client=default,-android_sdkless"),
    ["youtube:player_client=default,-android_sdkless"],
  );
});

test("parseExtractorArgs: nhiều dòng -> nhiều mục, trim và bỏ dòng rỗng", () => {
  const raw = "  youtube:player_client=web_embedded \n\n youtubetab:skip=authcheck  \n";
  assert.deepEqual(parseExtractorArgs(raw), [
    "youtube:player_client=web_embedded",
    "youtubetab:skip=authcheck",
  ]);
});

test("parseExtractorArgs: rỗng -> mảng rỗng (không truyền cờ)", () => {
  assert.deepEqual(parseExtractorArgs(""), []);
  assert.deepEqual(parseExtractorArgs("   \n  "), []);
  assert.deepEqual(parseExtractorArgs(null), []);
  assert.deepEqual(parseExtractorArgs(undefined), []);
});

test("loadYtdlpSettings: chưa có file -> mặc định", () => {
  const dir = tmpDir();
  assert.deepEqual(loadYtdlpSettings(dir), { extractorArgs: DEFAULT_EXTRACTOR_ARGS });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadYtdlpSettings: JSON hỏng -> mặc định, không ném lỗi", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "ytdlp-settings.json"), "{ hỏng", "utf-8");
  assert.deepEqual(loadYtdlpSettings(dir), { extractorArgs: DEFAULT_EXTRACTOR_ARGS });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadYtdlpSettings: chuỗi rỗng là lựa chọn CỐ Ý, không rơi về mặc định", () => {
  const dir = tmpDir();
  saveYtdlpSettings(dir, { extractorArgs: "" });
  assert.deepEqual(loadYtdlpSettings(dir), { extractorArgs: "" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("saveYtdlpSettings rồi loadYtdlpSettings trả đúng giá trị đã lưu", () => {
  const dir = tmpDir();
  saveYtdlpSettings(dir, { extractorArgs: "youtube:player_client=tv" });
  assert.deepEqual(loadYtdlpSettings(dir), { extractorArgs: "youtube:player_client=tv" });
  fs.rmSync(dir, { recursive: true, force: true });
});
