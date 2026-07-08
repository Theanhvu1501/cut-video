import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hexToRgb, rgbToHex, mapToNearest, averageColor, detectChromaColor,
} from "../sheet/chroma-detect.js";

test("hexToRgb parses with and without #", () => {
  assert.deepEqual(hexToRgb("#FF8000"), { r: 255, g: 128, b: 0 });
  assert.deepEqual(hexToRgb("00FF10"), { r: 0, g: 255, b: 16 });
});

test("rgbToHex pads and uppercases without #", () => {
  assert.equal(rgbToHex({ r: 0, g: 255, b: 16 }), "00FF10");
});

test("mapToNearest picks closest palette color by RGB distance", () => {
  const palette = ["22BDD6", "2B4052", "7FBFDE", "7097B8"];
  assert.equal(mapToNearest({ r: 40, g: 62, b: 80 }, palette), "2B4052");
  assert.equal(mapToNearest({ r: 34, g: 189, b: 210 }, palette), "22BDD6");
});

test("averageColor computes mean RGB from injected sharp", async () => {
  const fakeSharp = () => ({
    resize: () => ({ removeAlpha: () => ({ raw: () => ({
      toBuffer: async () => ({
        data: Buffer.from([0, 0, 0, 4, 6, 8]),
        info: { width: 2, height: 1, channels: 3 },
      }),
    }) }) }),
  });
  const avg = await averageColor(Buffer.from([]), { sharp: fakeSharp });
  assert.deepEqual(avg, { r: 2, g: 3, b: 4 });
});

test("detectChromaColor maps a frame's average color to nearest palette", async () => {
  const fakeSpawn = () => ({
    stdout: { on: (ev, cb) => { if (ev === "data") cb(Buffer.from([1])); } },
    stderr: { on: () => {} },
    on: (ev, cb) => { if (ev === "close") cb(0); },
  });
  const fakeSharp = () => ({
    resize: () => ({ removeAlpha: () => ({ raw: () => ({
      toBuffer: async () => ({ data: Buffer.from([40, 62, 80]), info: { width: 1, height: 1, channels: 3 } }),
    }) }) }),
  });
  const hex = await detectChromaColor("/v.mp4", ["22BDD6", "2B4052"], {
    ffmpegPath: "ffmpeg", spawn: fakeSpawn, sharp: fakeSharp,
  });
  assert.equal(hex, "2B4052");
});
