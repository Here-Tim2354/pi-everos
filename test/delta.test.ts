import assert from "node:assert/strict";
import { test } from "node:test";

import { deltaAfter, type Turn, toMessageItems } from "../src/delta.js";

function turn(entryId: string, role: Turn["role"] = "user"): Turn {
  return { entryId, role, text: entryId, timestamp: 1 };
}

const turns = [turn("a"), turn("b", "assistant"), turn("c")];

test("没有锚点就全发", () => {
  const delta = deltaAfter(turns, undefined);
  assert.deepEqual(
    delta.turns.map((item) => item.entryId),
    ["a", "b", "c"],
  );
  assert.equal(delta.anchor, "c");
  assert.equal(delta.lostAnchor, false);
});

test("只发锚点之后的部分", () => {
  const delta = deltaAfter(turns, "a");
  assert.deepEqual(
    delta.turns.map((item) => item.entryId),
    ["b", "c"],
  );
  assert.equal(delta.anchor, "c");
});

test("锚点已经是最后一条时什么都不发，锚点不动", () => {
  const delta = deltaAfter(turns, "c");
  assert.deepEqual(delta.turns, []);
  assert.equal(delta.anchor, "c");
});

test("锚点被压缩掉时宁可不发，也不重发", () => {
  const delta = deltaAfter(turns, "gone");
  assert.deepEqual(delta.turns, []);
  assert.equal(delta.anchor, "gone");
  assert.equal(delta.lostAnchor, true);
});

test("空上下文不发任何东西", () => {
  const delta = deltaAfter([], undefined);
  assert.deepEqual(delta.turns, []);
  assert.equal(delta.anchor, undefined);
});

test("助手消息挂在 agent 名下，用户消息挂在本人名下", () => {
  const items = toMessageItems(turns, { userId: "tim", agentId: "pi" });
  assert.deepEqual(
    items.map((item) => item.sender_id),
    ["tim", "pi", "tim"],
  );
  assert.deepEqual(
    items.map((item) => item.role),
    ["user", "assistant", "user"],
  );
});
