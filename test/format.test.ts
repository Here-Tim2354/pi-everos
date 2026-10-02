import assert from "node:assert/strict";
import { test } from "node:test";

import type { SearchData } from "../src/client.js";
import { renderRecall, renderSearch } from "../src/format.js";

const data: SearchData = {
  episodes: [
    {
      id: "tim_ep_1",
      subject: "测试习惯",
      summary: "Tim 一直用 pnpm 跑测试。",
      timestamp: "2026-10-02T12:00:00.000+08:00",
      atomic_facts: [{ content: "Tim stated that he always runs tests with pnpm." }],
    },
  ],
};

test("没有命中就返回空串，让调用方跳过注入", () => {
  assert.equal(renderRecall({}), "");
  assert.equal(renderRecall({ episodes: [] }), "");
});

test("召回文本带日期、标题和事实", () => {
  const text = renderRecall(data);
  assert.match(text, /2026-10-02/);
  assert.match(text, /测试习惯/);
  assert.match(text, /事实：Tim stated that he always runs tests with pnpm/);
});

test("超出预算时截到整行并留提示", () => {
  const many: SearchData = {
    episodes: Array.from({ length: 40 }, (_, index) => ({
      subject: `第 ${index} 条记忆`,
      summary: "内容".repeat(20),
    })),
  };
  const text = renderRecall(many, 300);
  assert.ok(text.length < 400, `实际长度 ${text.length}`);
  assert.match(text, /其余片段已省略/);
});

test("工具结果只说命中了什么，不带用不上的内部 id", () => {
  const text = renderSearch(data);
  assert.match(text, /命中 1 条记忆/);
  assert.match(text, /测试习惯/);
  assert.doesNotMatch(text, /tim_ep_1/);
});

test("工具没命中时说清楚没命中", () => {
  assert.equal(renderSearch({}), "没有命中记忆。");
});
