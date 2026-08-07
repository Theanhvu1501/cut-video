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

// GPM bản cũ trả profile ở /api/v3, bản mới ở /api/v1. Fake này mô phỏng một máy
// chỉ có MỘT bản: version còn lại trả 200 kèm danh sách rỗng (đúng như bản mới cư
// xử — không phải 404), nên không được dò bằng mỗi HTTP status.
function fakeGpm(liveVersion, { profiles = [{ id: "p1", name: "Kênh A" }], calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    const version = url.match(/\/api\/(v\d)\//)?.[1];
    const live = version === liveVersion;
    if (/\/profiles\?/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: live ? profiles : [] }) };
    }
    if (!live) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true, status: 200,
      json: async () => ({ success: true, data: { remote_debugging_address: "127.0.0.1:1234" } }),
    };
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

  assert.equal(await startProfile("h", "p1", { fetch }), "127.0.0.1:1234");
  await closeProfile("h", "p1", {}, { fetch });
  assert.ok(calls.includes("http://h/api/v1/profiles/start/p1"));
  assert.ok(calls.includes("http://h/api/v1/profiles/close/p1"));
  assert.ok(!calls.some((u) => /\/api\/v3\/profiles\/(start|close)\//.test(u)), "không được đụng v3");
});

test("máy chạy GPM bản cũ: chốt v3", async () => {
  const fetch = fakeGpm("v3");
  await testGpmConnection("h", { fetch });
  assert.equal(getGpmApiVersion("h"), "v3");
});

// Dò xong là nhớ: lần gọi sau chỉ còn đúng 1 request, không dò lại cả hai version.
test("nhớ version đã dò, lần sau không dò lại", async () => {
  const calls = [];
  const fetch = fakeGpm("v1", { calls });
  await testGpmConnection("h", { fetch });
  const afterFirst = calls.length;

  await testGpmConnection("h", { fetch });
  assert.deepEqual(calls.slice(afterFirst), ["http://h/api/v1/profiles?page=0&per_page=100"]);
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
