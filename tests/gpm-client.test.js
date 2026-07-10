import { test } from "node:test";
import assert from "node:assert/strict";
import { testGpmConnection, startProfile, closeProfile } from "../sheet/gpm-client.js";

function fakeFetch(status, body) {
  return async (url) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    _url: url,
  });
}

test("testGpmConnection map data -> {id,name} và gọi đúng URL", async () => {
  let called;
  const fetch = async (url) => { called = url; return { ok: true, status: 200,
    json: async () => ({ data: [{ id: "p1", name: "Kênh A" }, { id: "p2" }] }) }; };
  const out = await testGpmConnection("127.0.0.1:19995", { fetch });
  assert.match(called, /^http:\/\/127\.0\.0\.1:19995\/api\/v3\/profiles\?/);
  assert.deepEqual(out, [{ id: "p1", name: "Kênh A" }, { id: "p2", name: "p2" }]);
});

test("testGpmConnection ném lỗi khi HTTP không ok", async () => {
  await assert.rejects(
    () => testGpmConnection("h", { fetch: fakeFetch(500, {}) }),
    /GPM HTTP 500/,
  );
});

test("startProfile trả remote_debugging_address", async () => {
  const fetch = fakeFetch(200, { success: true, data: { remote_debugging_address: "127.0.0.1:1234" } });
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
  const fetch = async (url) => { events.push(`fetch ${url}`); return { ok: true, status: 200 }; };
  await closeProfile("127.0.0.1:19995", "p1", { browser }, { fetch });
  assert.deepEqual(events, [
    "browser.close",
    "fetch http://127.0.0.1:19995/api/v3/profiles/close/p1",
  ]);
});

test("closeProfile: browser.close() ném (CDP đã chết) vẫn phải gọi API close", async () => {
  let called = null;
  const browser = { close: async () => { throw new Error("CDP đã đóng"); } };
  const fetch = async (url) => { called = url; return { ok: true, status: 200 }; };
  await closeProfile("h", "p1", { browser }, { fetch });
  assert.equal(called, "http://h/api/v3/profiles/close/p1");
});

test("closeProfile: HTTP không ok -> ném lỗi", async () => {
  await assert.rejects(
    () => closeProfile("h", "p1", {}, { fetch: fakeFetch(500, {}) }),
    /GPM HTTP 500/,
  );
});
