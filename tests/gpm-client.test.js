import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  testGpmConnection,
  startProfile,
  closeProfile,
  resetGpmVersionCache,
  getGpmApiVersion,
} from "../sheet/gpm-client.js";

// Version dò được nhớ theo host trong suốt phiên — mỗi test phải bắt đầu từ trắng.
beforeEach(() => resetGpmVersionCache());

function fakeFetch(status, body) {
  return async (url) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    _url: url,
  });
}

// Hai bản GPM là hai API KHÁC NHAU, không phải cùng một API đổi mỗi số version:
//   bản cũ (/api/v3): danh sách nằm thẳng ở `data`; đóng bằng /profiles/close/{id};
//     start trả `remote_debugging_address` sẵn dạng "host:port".
//   bản mới (/api/v1): danh sách nằm trong bọc phân trang `data.data`; đóng bằng
//     /profiles/stop/{id}; start chỉ trả `remote_debugging_port` là số.
// Version không có trên máy trả 200 kèm danh sách rỗng (không phải 404) — nên
// không dò được bằng mỗi HTTP status.
function fakeGpm(liveVersion, { profiles = [{ id: "p1", name: "Kênh A" }], calls = [] } = {}) {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const notFound = { ok: false, status: 404, json: async () => ({}) };
  return async (url) => {
    calls.push(url);
    const version = url.match(/\/api\/(v\d)\//)?.[1];

    if (/\/profiles\?/.test(url)) {
      if (version !== liveVersion) return ok({ success: true, data: [] });
      return ok(version === "v1"
        ? { success: true, data: { current_page: 1, per_page: 30, total: profiles.length, last_page: 1, data: profiles } }
        : { success: true, data: profiles });
    }

    if (version !== liveVersion) return notFound;

    if (/\/profiles\/start\//.test(url)) {
      return ok(version === "v1"
        ? { success: true, data: { profile_id: "p1", remote_debugging_port: 40444,
            websocket_debugging_url: "ws://127.0.0.1:40444/devtools/browser/abc" } }
        : { success: true, data: { remote_debugging_address: "127.0.0.1:1234" } });
    }

    // Mỗi bản chỉ nhận đúng đường dẫn đóng của mình, gọi nhầm là 404.
    const closePath = version === "v1" ? "/profiles/stop/" : "/profiles/close/";
    return url.includes(closePath) ? ok({ success: true, data: null }) : notFound;
  };
}

test("testGpmConnection map data -> {id,name} và gọi đúng URL", async () => {
  const calls = [];
  const fetch = fakeGpm("v3", { calls });
  const out = await testGpmConnection("127.0.0.1:19995", { fetch });
  assert.ok(calls.some((u) => /^http:\/\/127\.0\.0\.1:19995\/api\/v3\/profiles\?/.test(u)));
  assert.deepEqual(out, [{ id: "p1", name: "Kênh A" }]);
});

test("testGpmConnection ném lỗi khi HTTP không ok", async () => {
  await assert.rejects(
    () => testGpmConnection("h", { fetch: fakeFetch(500, {}) }),
    /GPM HTTP 500/,
  );
});

// ===== Tự dò /api/v3 (GPM bản cũ) hay /api/v1 (bản mới) =====

test("máy chạy GPM bản mới: dò ra v1, start/close cũng đi v1", async () => {
  const calls = [];
  const fetch = fakeGpm("v1", { calls });

  const out = await testGpmConnection("h", { fetch });
  assert.deepEqual(out, [{ id: "p1", name: "Kênh A" }]);
  assert.equal(getGpmApiVersion("h"), "v1");

  assert.equal(await startProfile("h", "p1", { fetch }), "127.0.0.1:40444");
  await closeProfile("h", "p1", {}, { fetch });
  assert.ok(calls.includes("http://h/api/v1/profiles/start/p1"));
  assert.ok(calls.includes("http://h/api/v1/profiles/stop/p1"));
  assert.ok(!calls.some((u) => /\/api\/v3\/profiles\/(start|close|stop)\//.test(u)), "không được đụng v3");
});

test("máy chạy GPM bản cũ: chốt v3", async () => {
  const fetch = fakeGpm("v3");
  await testGpmConnection("h", { fetch });
  assert.equal(getGpmApiVersion("h"), "v3");
});

// ===== Bản mới (/api/v1) khác bản cũ ở đâu =====

// Bản mới bọc danh sách trong phân trang. Bóc ở `data` như bản cũ thì vớ phải
// object — đúng cái đã làm nút Test nổ "(...).map is not a function".
test("v1: bóc danh sách profile nằm trong bọc phân trang data.data", async () => {
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({
    success: true,
    data: { current_page: 1, per_page: 30, total: 1, last_page: 1, data: [{ id: "p1", name: "Kênh A" }] },
    message: "OK",
  }) });
  assert.deepEqual(await testGpmConnection("h", { fetch }), [{ id: "p1", name: "Kênh A" }]);
  assert.equal(getGpmApiVersion("h"), "v1");
});

// Bản mới đặt tên tham số là page_size và đánh trang từ 1. Gửi per_page/page=0
// theo kiểu bản cũ thì GPM bỏ qua, chỉ trả về trang mặc định 30 profile.
test("v1: gửi đúng tham số phân trang page_size, trang bắt đầu từ 1", async () => {
  const calls = [];
  const fetch = fakeGpm("v1", { calls });
  await testGpmConnection("h", { fetch });

  const listUrl = calls.find((u) => /\/api\/v1\/profiles\?/.test(u));
  assert.match(listUrl, /[?&]page=1(&|$)/);
  assert.match(listUrl, /[?&]page_size=\d+/);
  assert.doesNotMatch(listUrl, /per_page/);
});

// Bản mới không có remote_debugging_address, chỉ có cổng rời — phải tự ghép,
// không thì connectOverCDP nhận undefined.
test("v1: startProfile ghép địa chỉ CDP từ remote_debugging_port", async () => {
  const fetch = fakeGpm("v1");
  assert.equal(await startProfile("h", "p1", { fetch }), "127.0.0.1:40444");
});

// Bản mới đóng trình duyệt bằng /profiles/stop. Gọi /close sẽ ăn 404 → trình
// duyệt không bao giờ tắt, mà 404 đó còn bị hiểu nhầm thành "sai version".
test("v1: closeProfile gọi /profiles/stop chứ không phải /profiles/close", async () => {
  const calls = [];
  const fetch = fakeGpm("v1", { calls });
  await closeProfile("h", "p1", {}, { fetch });

  assert.ok(calls.includes("http://h/api/v1/profiles/stop/p1"));
  assert.ok(!calls.some((u) => u.includes("/profiles/close/")), "v1 không có /profiles/close");
});

// Máy chạy bản mới vẫn TRẢ 200 cho /api/v3 — chỉ là dữ liệu không đúng khuôn.
// Nên không được dò bằng HTTP status: phải chấm bằng "bên nào bóc ra profile
// thật". Ở đây cả hai đường dẫn cùng trả body kiểu v1.
test("máy v1 trả 200 cho cả /api/v3: vẫn chốt đúng v1", async () => {
  const body = {
    success: true,
    data: { current_page: 1, per_page: 30, total: 1, last_page: 1, data: [{ id: "p1", name: "Kênh A" }] },
  };
  const fetch = async () => ({ ok: true, status: 200, json: async () => body });

  assert.deepEqual(await testGpmConnection("h", { fetch }), [{ id: "p1", name: "Kênh A" }]);
  assert.equal(getGpmApiVersion("h"), "v1");
});

// Chiều ngược lại: máy bản cũ trả 200 cho /api/v1 kèm body kiểu v3.
test("máy v3 trả 200 cho cả /api/v1: vẫn chốt đúng v3", async () => {
  const body = { success: true, data: [{ id: "p1", name: "Kênh A" }] };
  const fetch = async () => ({ ok: true, status: 200, json: async () => body });

  assert.deepEqual(await testGpmConnection("h", { fetch }), [{ id: "p1", name: "Kênh A" }]);
  assert.equal(getGpmApiVersion("h"), "v3");
});

// Bản cũ vẫn phải y nguyên như trước: đóng bằng /close, start đọc thẳng địa chỉ.
test("v3: giữ nguyên /profiles/close và remote_debugging_address", async () => {
  const calls = [];
  const fetch = fakeGpm("v3", { calls });
  assert.equal(await startProfile("h", "p1", { fetch }), "127.0.0.1:1234");
  await closeProfile("h", "p1", {}, { fetch });

  assert.ok(calls.includes("http://h/api/v3/profiles/close/p1"));
  assert.ok(!calls.some((u) => u.includes("/profiles/stop/")), "v3 không có /profiles/stop");
});

// Dò xong là nhớ: lần gọi sau chỉ còn đúng 1 request, không dò lại cả hai version.
test("nhớ version đã dò, lần sau không dò lại", async () => {
  const calls = [];
  const fetch = fakeGpm("v1", { calls });
  await testGpmConnection("h", { fetch });
  const afterFirst = calls.length;

  await testGpmConnection("h", { fetch });
  assert.equal(calls.length - afterFirst, 1, "chỉ 1 request, không dò lại cả hai bản");
  assert.match(calls[afterFirst], /^http:\/\/h\/api\/v1\/profiles\?/);
});

// Máy chưa tạo profile nào thì cả hai version cùng trả rỗng — không phân biệt nổi.
// Chốt vội là sai cho cả phiên, nên phải để trống cache và dò lại lần sau.
test("chưa có profile nào: không chốt version, lần sau dò lại", async () => {
  const empty = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: [] }) });
  assert.deepEqual(await testGpmConnection("h", { fetch: empty }), []);
  assert.equal(getGpmApiVersion("h"), undefined);

  // Tạo profile xong, lần dò sau nhận ra đúng v1.
  const fetch = fakeGpm("v1");
  await testGpmConnection("h", { fetch });
  assert.equal(getGpmApiVersion("h"), "v1");
});

// GPM chưa bật: lỗi phải là lỗi kết nối, đừng đổ cho version.
test("GPM chưa chạy: giữ nguyên thông điệp lỗi gốc", async () => {
  const fetch = async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:19995"); };
  await assert.rejects(() => testGpmConnection("h", { fetch }), /ECONNREFUSED/);
});

test("GPM trả success:false: báo message của GPM", async () => {
  const fetch = fakeFetch(200, { success: false, message: "API chưa được bật" });
  await assert.rejects(() => testGpmConnection("h", { fetch }), /API chưa được bật/);
});

// Nâng cấp GPM giữa phiên: version cũ trong cache thành sai, start trả 404 →
// quên đi để lần sau dò lại, khỏi phải khởi động lại app.
test("start trả 404 thì quên version đã nhớ", async () => {
  const fetch = fakeGpm("v3");
  await testGpmConnection("h", { fetch });
  assert.equal(getGpmApiVersion("h"), "v3");

  await assert.rejects(() => startProfile("h", "p1", { fetch: fakeFetch(404, {}) }), /GPM HTTP 404/);
  assert.equal(getGpmApiVersion("h"), undefined);
});

test("startProfile trả remote_debugging_address", async () => {
  const fetch = fakeGpm("v3");
  const addr = await startProfile("h", "p1", { fetch });
  assert.equal(addr, "127.0.0.1:1234");
});

// GPM báo thành công nhưng thiếu địa chỉ CDP: trả undefined thì lỗi nổ tận
// connectOverCDP("http://undefined"), chẳng ai lần ra. Báo ngay tại chỗ.
test("startProfile ném lỗi khi GPM không trả địa chỉ CDP", async () => {
  const fetch = async (url) => (/\/profiles\?/.test(url)
    ? { ok: true, status: 200, json: async () => ({ success: true, data: [{ id: "p1" }] }) }
    : { ok: true, status: 200, json: async () => ({ success: true, data: { profile_id: "p1" } }) });
  await assert.rejects(() => startProfile("h", "p1", { fetch }), /không trả địa chỉ/);
});

test("startProfile ném lỗi khi success=false", async () => {
  await assert.rejects(
    () => startProfile("h", "p1", { fetch: fakeFetch(200, { success: false, message: "x" }) }),
    /GPM error/,
  );
});

test("closeProfile: ngắt CDP TRƯỚC rồi mới gọi API close", async () => {
  const events = [];
  const browser = { close: async () => { events.push("browser.close"); } };
  const gpm = fakeGpm("v3");
  const fetch = async (url) => { events.push(`fetch ${url}`); return gpm(url); };
  await closeProfile("127.0.0.1:19995", "p1", { browser }, { fetch });
  // Lọc bỏ request dò version, chỉ giữ thứ tự giữa ngắt CDP và lệnh close.
  assert.deepEqual(events.filter((e) => !/\/profiles\?/.test(e)), [
    "browser.close",
    "fetch http://127.0.0.1:19995/api/v3/profiles/close/p1",
  ]);
});

test("closeProfile: browser.close() ném (CDP đã chết) vẫn phải gọi API close", async () => {
  let called = null;
  const browser = { close: async () => { throw new Error("CDP đã đóng"); } };
  const gpm = fakeGpm("v3");
  const fetch = async (url) => { if (!/\/profiles\?/.test(url)) called = url; return gpm(url); };
  await closeProfile("h", "p1", { browser }, { fetch });
  assert.equal(called, "http://h/api/v3/profiles/close/p1");
});

test("closeProfile: HTTP không ok -> ném lỗi", async () => {
  await assert.rejects(
    () => closeProfile("h", "p1", {}, { fetch: fakeFetch(500, {}) }),
    /GPM HTTP 500/,
  );
});
