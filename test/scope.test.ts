import assert from "node:assert/strict";
import { test } from "node:test";

import { projectIdFromCwd, sanitizeId } from "../src/scope.js";

test("合法字符原样保留", () => {
  assert.equal(sanitizeId("pi-memory-everOS", "default"), "pi-memory-everOS");
});

test("非法字符换成短横线并补短哈希", () => {
  assert.match(sanitizeId("my repo", "default"), /^my-repo-[0-9a-f]{6}$/);
});

test("中文名清空后靠短哈希区分", () => {
  const one = sanitizeId("我的仓库", "default");
  assert.match(one, /^default-[0-9a-f]{6}$/);
  assert.notEqual(one, sanitizeId("另一个仓库", "default"));
});

test("同一个输入永远算出同一个 id", () => {
  assert.equal(sanitizeId("我的仓库", "default"), sanitizeId("我的仓库", "default"));
});

test("空值和点号落回兜底值", () => {
  assert.equal(sanitizeId("", "default"), "default");
  assert.equal(sanitizeId("   ", "default"), "default");
  assert.equal(sanitizeId(".", "default"), "default");
  assert.equal(sanitizeId("..", "default"), "default");
});

test("超长截到 128 位", () => {
  assert.equal(sanitizeId("a".repeat(200), "default").length, 128);
});

test("项目 id 取工作目录名", () => {
  assert.equal(projectIdFromCwd("E:\\Learning\\Programming\\pi-everos"), "pi-everos");
});
