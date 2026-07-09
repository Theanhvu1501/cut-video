import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProxy } from "../sheet/proxy.js";

test("normalizeProxy giữ nguyên chuỗi đã đủ scheme", () => {
  assert.equal(normalizeProxy("socks5://1.2.3.4:1080"), "socks5://1.2.3.4:1080");
  assert.equal(normalizeProxy("http://user:pass@host.vn:8080"), "http://user:pass@host.vn:8080");
  assert.equal(normalizeProxy("HTTPS://1.2.3.4:443"), "https://1.2.3.4:443");
});

test("normalizeProxy thêm scheme http khi thiếu", () => {
  assert.equal(normalizeProxy("1.2.3.4:8080"), "http://1.2.3.4:8080");
  assert.equal(normalizeProxy("  1.2.3.4:8080  "), "http://1.2.3.4:8080");
});

test("normalizeProxy đổi host:port:user:pass sang dạng URL", () => {
  assert.equal(normalizeProxy("1.2.3.4:8080:bob:s3cret"), "http://bob:s3cret@1.2.3.4:8080");
  assert.equal(normalizeProxy("socks5://1.2.3.4:1080:bob:s3cret"), "socks5://bob:s3cret@1.2.3.4:1080");
});

test("normalizeProxy là idempotent (chuẩn hoá lần hai không đổi)", () => {
  const once = normalizeProxy("1.2.3.4:8080:bob:s3cret");
  assert.equal(normalizeProxy(once), once);
});

test("normalizeProxy ném lỗi với đầu vào hỏng", () => {
  assert.throws(() => normalizeProxy(""), /chuỗi rỗng/);
  assert.throws(() => normalizeProxy("   "), /chuỗi rỗng/);
  assert.throws(() => normalizeProxy("rác"), /không hợp lệ/);
  assert.throws(() => normalizeProxy("1.2.3.4:abc"), /không hợp lệ/);
  assert.throws(() => normalizeProxy("1.2.3.4:70000"), /không hợp lệ/);
  assert.throws(() => normalizeProxy("ftp://1.2.3.4:21"), /không hỗ trợ/);
});
