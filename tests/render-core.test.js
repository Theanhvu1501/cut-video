import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComplexFilter, resolveFfmpegPaths } from "../sheet/render-core.js";

test("topTransparent uses opacity and overlay at 0:0", () => {
  const f = buildComplexFilter("topTransparent", { opacity: 0.7 });
  const joined = f.join("|");
  assert.match(joined, /colorchannelmixer=aa=0\.7\[top_video\]/);
  assert.ok(f.includes("[base_video][top_video]overlay=0:0[combined_video]"));
  assert.ok(f.includes("[1:a]volume=1.0[overlay_audio]"));
});

test("chromaKey embeds color + similarity, overlay at H-h", () => {
  const f = buildComplexFilter("chromaKey", { chromaColor: "D4F9D7", chromaSimilarity: 0.3 });
  assert.match(f.join("|"), /colorkey=0xD4F9D7:0\.3:0\.1,format=yuva420p\[overlay_video\]/);
  assert.ok(f.includes("[0:v][overlay_video]overlay=0:H-h[combined_video]"));
});

test("crop uses cropHeight/cropYOffset", () => {
  const f = buildComplexFilter("crop", { cropHeight: 150, cropYOffset: 550 });
  assert.match(f.join("|"), /crop=1280:150:0:550\[cropped\]/);
  assert.ok(f.includes("[0:v][overlay_video]overlay=0:H-h[combined_video]"));
});

test("keepColor builds per-color masks and alphamerge", () => {
  const f = buildComplexFilter("keepColor", { keepColors: ["F6FF00"], keepSimilarity: 0.2 });
  const joined = f.join("|");
  assert.match(joined, /colorkey=0xF6FF00:0\.2:0\.1,alphaextract,negate\[mask_0\]/);
  assert.match(joined, /\[src_main\]\[mask_0\]alphamerge\[final_isolated\]/);
});

test("chromaKeyAuto uses same filter as chromaKey (color already resolved)", () => {
  const cfg = { chromaColor: "2B4052", chromaSimilarity: 0.3 };
  const auto = buildComplexFilter("chromaKeyAuto", cfg);
  const manual = buildComplexFilter("chromaKey", cfg);
  assert.deepEqual(auto, manual);
  assert.match(auto.join("|"), /colorkey=0x2B4052:0\.3:0\.1/);
});

test("invalid mode falls back to topTransparent", () => {
  const f = buildComplexFilter("nope", {});
  assert.ok(f.some((s) => s.includes("[base_video][top_video]overlay=0:0[combined_video]")));
});

test("resolveFfmpegPaths returns string paths", () => {
  const { ffmpegPath, ffprobePath } = resolveFfmpegPaths();
  assert.equal(typeof ffmpegPath, "string");
  assert.equal(typeof ffprobePath, "string");
  assert.ok(ffmpegPath.length > 0);
  assert.ok(ffprobePath.length > 0);
});
