import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  todayStr, shouldResetQuota, computeRemaining, recordRendered,
  loadState, saveState,
} from "../sheet/runner-state.js";

test("todayStr formats local date as YYYY-MM-DD", () => {
  const d = new Date(2026, 6, 7, 15, 30); // 2026-07-07 local
  assert.equal(todayStr(d), "2026-07-07");
});

test("shouldResetQuota true when no state or different day", () => {
  assert.equal(shouldResetQuota(undefined, "2026-07-07"), true);
  assert.equal(shouldResetQuota({ lastRunDate: "2026-07-06", countToday: 3 }, "2026-07-07"), true);
  assert.equal(shouldResetQuota({ lastRunDate: "2026-07-07", countToday: 3 }, "2026-07-07"), false);
});

test("computeRemaining resets on new day, clamps at 0", () => {
  assert.equal(computeRemaining(undefined, 3, "2026-07-07"), 3);
  assert.equal(computeRemaining({ lastRunDate: "2026-07-06", countToday: 5 }, 3, "2026-07-07"), 3);
  assert.equal(computeRemaining({ lastRunDate: "2026-07-07", countToday: 2 }, 3, "2026-07-07"), 1);
  assert.equal(computeRemaining({ lastRunDate: "2026-07-07", countToday: 5 }, 3, "2026-07-07"), 0);
});

test("recordRendered resets on new day then increments", () => {
  const state = { "Kênh A": { lastRunDate: "2026-07-06", countToday: 5 } };
  recordRendered(state, "Kênh A", "2026-07-07");
  assert.deepEqual(state["Kênh A"], { lastRunDate: "2026-07-07", countToday: 1 });
  recordRendered(state, "Kênh A", "2026-07-07");
  assert.equal(state["Kênh A"].countToday, 2);
  recordRendered(state, "Kênh B", "2026-07-07");
  assert.deepEqual(state["Kênh B"], { lastRunDate: "2026-07-07", countToday: 1 });
});

test("loadState returns {} when missing or corrupt, saveState round-trips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
  const p = path.join(dir, "runner-state.json");
  assert.deepEqual(loadState(p), {});
  fs.writeFileSync(p, "{ not json");
  assert.deepEqual(loadState(p), {});
  const state = { "Kênh A": { lastRunDate: "2026-07-07", countToday: 2 } };
  saveState(p, state);
  assert.deepEqual(loadState(p), state);
});
