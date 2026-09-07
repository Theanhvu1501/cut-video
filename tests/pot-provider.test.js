// Vòng đời server bgutil sinh PO token. Ba tình huống thật đã gặp khi thử tay:
// server đã chạy sẵn (bản portable đang mở, hoặc phiên trước chưa tắt), port bận,
// và server không bao giờ lên. Cả ba phải kết thúc gọn chứ không treo app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { potBaseUrl, startPotServer } from "../sheet/pot-provider.js";

// Child giả: đủ interface mà startPotServer dùng (kill/on/pid).
function fakeChild() {
  const handlers = {};
  return {
    pid: 1234,
    killed: false,
    on(ev, fn) {
      handlers[ev] = fn;
      return this;
    },
    kill() {
      this.killed = true;
    },
    emit(ev, ...args) {
      handlers[ev]?.(...args);
    },
  };
}

// Phải nhường event loop thật (setImmediate) chứ không chỉ là promise đã resolve:
// microtask không cho callback "exit" của tiến trình con chạy, nhánh "cổng bận" sẽ
// pass vì hết lượt ping chứ không phải vì phát hiện được tiến trình đã chết.
const noSleep = () => new Promise((r) => setImmediate(r));

test("potBaseUrl dựng đúng địa chỉ loopback", () => {
  assert.equal(potBaseUrl(4416), "http://127.0.0.1:4416");
  assert.equal(potBaseUrl(4417), "http://127.0.0.1:4417");
});

// Có server sẵn thì DÙNG LẠI, không spawn thêm: hai tiến trình bgutil cùng lúc chỉ
// tốn RAM, và cái spawn sau sẽ chết vì port bận.
test("server đã chạy sẵn thì dùng lại, không spawn", async () => {
  let spawned = 0;
  const srv = await startPotServer({
    nodePath: "node",
    serverDir: "C:\\bgutil",
    spawnFn: () => {
      spawned++;
      return fakeChild();
    },
    pingFn: async () => ({ server_uptime: 12, version: "1.3.1" }),
    sleepFn: noSleep,
  });
  assert.equal(spawned, 0);
  assert.equal(srv.reused, true);
  assert.equal(srv.port, 4416);
  assert.equal(srv.baseUrl, "http://127.0.0.1:4416");
  await srv.stop(); // không được kill thứ mình không sở hữu
});

test("chưa có server thì spawn rồi đợi ping lên", async () => {
  const child = fakeChild();
  let pings = 0;
  const srv = await startPotServer({
    nodePath: "D:\\bin\\node.exe",
    serverDir: "D:\\bin\\bgutil\\server",
    spawnFn: () => child,
    // Lần đầu (dò port) hỏng, vài lần sau vẫn hỏng, rồi mới lên.
    pingFn: async () => {
      pings++;
      if (pings < 3) throw new Error("ECONNREFUSED");
      return { server_uptime: 0.4, version: "1.3.1" };
    },
    sleepFn: noSleep,
  });
  assert.equal(srv.reused, false);
  assert.equal(srv.port, 4416);
  await srv.stop();
  assert.equal(child.killed, true);
});

test("truyền đúng node, script và cổng cho tiến trình con", async () => {
  let seen = null;
  const srv = await startPotServer({
    nodePath: "D:\\bin\\node.exe",
    serverDir: "D:\\bin\\bgutil\\server",
    spawnFn: (cmd, args, opts) => {
      seen = { cmd, args, opts };
      return fakeChild();
    },
    pingFn: async () => {
      if (!seen) throw new Error("ECONNREFUSED");
      return { server_uptime: 1, version: "1.3.1" };
    },
    sleepFn: noSleep,
  });
  assert.equal(seen.cmd, "D:\\bin\\node.exe");
  assert.ok(seen.args[0].endsWith("main.js"), `script phải là main.js, nhận: ${seen.args[0]}`);
  assert.ok(seen.args.includes("--port"));
  assert.equal(seen.args[seen.args.indexOf("--port") + 1], "4416");
  assert.equal(seen.opts.cwd, "D:\\bin\\bgutil\\server");
  await srv.stop();
});

// Port bận (một app khác chiếm 4416, không phải bgutil) -> tiến trình con chết ngay.
// Phải nhảy sang port kế tiếp chứ không bỏ cuộc.
test("port bận thì thử port kế tiếp", async () => {
  const ports = [];
  let attempt = 0;
  const srv = await startPotServer({
    nodePath: "node",
    serverDir: "C:\\bgutil",
    spawnFn: (_cmd, args) => {
      ports.push(args[args.indexOf("--port") + 1]);
      const c = fakeChild();
      attempt++;
      // Lần spawn đầu chết ngay vì EADDRINUSE.
      if (attempt === 1) setImmediate(() => c.emit("exit", 1));
      return c;
    },
    pingFn: async () => {
      if (attempt >= 2) return { server_uptime: 1, version: "1.3.1" };
      throw new Error("ECONNREFUSED");
    },
    sleepFn: noSleep,
  });
  assert.deepEqual(ports, ["4416", "4417"]);
  assert.equal(srv.port, 4417);
  await srv.stop();
});

// Không lên được thì trả null chứ KHÔNG ném: thiếu PO token vẫn tải được (chậm hơn,
// dễ dính bot-check hơn), còn ném lỗi ở đây là chặn luôn cả app không cho tải.
test("server không bao giờ lên thì trả null, không ném lỗi", async () => {
  const srv = await startPotServer({
    nodePath: "node",
    serverDir: "C:\\bgutil",
    spawnFn: () => fakeChild(),
    pingFn: async () => {
      throw new Error("ECONNREFUSED");
    },
    sleepFn: noSleep,
    attempts: 2,
  });
  assert.equal(srv, null);
});

test("thiếu nodePath hoặc serverDir thì trả null ngay", async () => {
  assert.equal(await startPotServer({ serverDir: "C:\\bgutil", sleepFn: noSleep }), null);
  assert.equal(await startPotServer({ nodePath: "node", sleepFn: noSleep }), null);
});
