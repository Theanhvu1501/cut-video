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

import { fetchChannelStats } from "../sheet/youtube-api.js";

// Client YouTube giả: ghi lại mọi tham số truyền vào channels.list.
function fakeYt({ items = [], throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    channels: {
      list: async (params) => {
        calls.push(params);
        if (throwOn && throwOn(params)) throw new Error("quotaExceeded");
        const wanted = params.id
          ? items.filter((it) => params.id.includes(it.id))
          : items.filter((it) => it._handle === params.forHandle);
        return { data: { items: wanted } };
      },
    },
  };
}

const CHAN = (id, handle, subs, views, vids, hidden = false) => ({
  id,
  _handle: handle,
  snippet: { title: `Kênh ${id}` },
  statistics: hidden
    ? { viewCount: String(views), videoCount: String(vids), hiddenSubscriberCount: true }
    : { subscriberCount: String(subs), viewCount: String(views), videoCount: String(vids) },
});

test("fetchChannelStats gộp các UC… vào một lần gọi, tách @handle thành gọi lẻ", async () => {
  const yt = fakeYt({
    items: [
      CHAN("UCBR8-60-B28hp2BmDPdntcQ", null, 100, 2000, 30),
      CHAN("UCaaaaaaaaaaaaaaaaaaaaaa", null, 200, 3000, 40),
      CHAN("UCbbbbbbbbbbbbbbbbbbbbbb", "@line4091", 300, 4000, 50),
    ],
  });
  const out = await fetchChannelStats(yt, [
    "UCBR8-60-B28hp2BmDPdntcQ",
    "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa",
    "@line4091",
  ]);

  const idCalls = yt.calls.filter((c) => c.id);
  const handleCalls = yt.calls.filter((c) => c.forHandle);
  assert.equal(idCalls.length, 1, "hai UC… phải gộp vào đúng một lần gọi");
  assert.deepEqual(idCalls[0].id, ["UCBR8-60-B28hp2BmDPdntcQ", "UCaaaaaaaaaaaaaaaaaaaaaa"]);
  assert.equal(handleCalls.length, 1);
  assert.equal(handleCalls[0].forHandle, "@line4091");

  assert.equal(out.length, 3);
  assert.equal(out[0].subscribers, 100);
  assert.equal(out[1].views, 3000);
  assert.equal(out[2].videoCount, 50);
  assert.equal(out[2].title, "Kênh UCbbbbbbbbbbbbbbbbbbbbbb");
});

test("fetchChannelStats: ref hỏng không kéo sập các ref còn lại", async () => {
  const yt = fakeYt({ items: [CHAN("UCBR8-60-B28hp2BmDPdntcQ", null, 100, 2000, 30)] });
  const out = await fetchChannelStats(yt, ["kênh của tôi", "UCBR8-60-B28hp2BmDPdntcQ", "@khong-ton-tai"]);
  assert.equal(out[0].error, "Link kênh không hợp lệ");
  assert.equal(out[1].subscribers, 100);
  assert.equal(out[2].error, "Không tìm thấy kênh");
});

test("fetchChannelStats: kênh ẩn sub trả subscribers null, hidden true", async () => {
  const yt = fakeYt({ items: [CHAN("UCBR8-60-B28hp2BmDPdntcQ", null, 0, 2000, 30, true)] });
  const [s] = await fetchChannelStats(yt, ["UCBR8-60-B28hp2BmDPdntcQ"]);
  assert.equal(s.subscribers, null);
  assert.equal(s.hidden, true);
  assert.equal(s.views, 2000);
});

test("fetchChannelStats: API ném lỗi thì mọi ref trong lô đó nhận error", async () => {
  const yt = fakeYt({ items: [], throwOn: () => true });
  const out = await fetchChannelStats(yt, ["UCBR8-60-B28hp2BmDPdntcQ", "@line4091"]);
  assert.match(out[0].error, /quotaExceeded/);
  assert.match(out[1].error, /quotaExceeded/);
});
