import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChannelRef, videoIdOf, pickNewUrls, parseDuration } from "../sheet/youtube-api.js";

test("parseChannelRef nhận 4 dạng hợp lệ", () => {
  assert.deepEqual(parseChannelRef("@line4091"), { type: "handle", value: "@line4091" });
  assert.deepEqual(parseChannelRef("line4091"), { type: "handle", value: "@line4091" });
  assert.deepEqual(parseChannelRef("https://www.youtube.com/@line4091"), { type: "handle", value: "@line4091" });
  assert.deepEqual(parseChannelRef("https://youtube.com/@line4091/videos?x=1"), { type: "handle", value: "@line4091" });
  assert.deepEqual(parseChannelRef("https://www.youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ"), { type: "id", value: "UCBR8-60-B28hp2BmDPdntcQ" });
  assert.deepEqual(parseChannelRef("UCBR8-60-B28hp2BmDPdntcQ"), { type: "id", value: "UCBR8-60-B28hp2BmDPdntcQ" });
});

test("parseChannelRef trả null với rác", () => {
  assert.equal(parseChannelRef(""), null);
  assert.equal(parseChannelRef("   "), null);
  assert.equal(parseChannelRef(undefined), null);
  assert.equal(parseChannelRef("kênh của tôi"), null);
  assert.equal(parseChannelRef("https://www.youtube.com/c/SomeOldName"), null);
  assert.equal(parseChannelRef("https://youtu.be/dQw4w9WgXcQ"), null);
});

test("videoIdOf chuẩn hoá mọi dạng URL video", () => {
  assert.equal(videoIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://example.com/abc"), null);
  assert.equal(videoIdOf(""), null);
});

test("pickNewUrls bỏ trùng kể cả khi hai URL khác dạng cùng trỏ một video", () => {
  const existing = ["https://youtu.be/aaaaaaaaaaa"];
  const fetched = [
    "https://www.youtube.com/watch?v=aaaaaaaaaaa", // trùng existing, khác dạng
    "https://www.youtube.com/watch?v=bbbbbbbbbbb",
    "https://www.youtube.com/watch?v=bbbbbbbbbbb", // trùng trong chính fetched
  ];
  assert.deepEqual(pickNewUrls(existing, fetched), ["https://www.youtube.com/watch?v=bbbbbbbbbbb"]);
});

test("pickNewUrls: trùng hoàn toàn trả mảng rỗng, không trùng trả nguyên danh sách", () => {
  const a = ["https://www.youtube.com/watch?v=aaaaaaaaaaa"];
  assert.deepEqual(pickNewUrls(a, a), []);
  assert.deepEqual(pickNewUrls([], a), a);
  assert.deepEqual(pickNewUrls(undefined, a), a);
});

test("parseDuration đổi ISO 8601 sang giây", () => {
  assert.equal(parseDuration("PT10M30S"), 630);
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration(""), 0);
});
