import assert from "node:assert/strict";
import { test } from "node:test";

import type { GetData, MemoryItem, ProfileItem, SearchData } from "../src/client.js";
import { renderList, renderRecall, renderSearch } from "../src/format.js";

const episodes: MemoryItem[] = [
  {
    id: "tim_ep_1",
    subject: "测试习惯",
    summary: "Tim 一直用 pnpm 跑测试。",
    timestamp: "2026-10-02T12:00:00.000+08:00",
    atomic_facts: [{ content: "Tim stated that he always runs tests with pnpm." }],
  },
];

const data: SearchData = { episodes };

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

const profileItems: ProfileItem[] = [
  {
    id: "profile_tim",
    profile_data: {
      summary: "Tim 同时做 Web 前端和 pi 后端。",
      explicit_info: [
        { category: "技术栈", description: "前端用 React 和 TypeScript。" },
        { category: "环境", description: "在 Windows 本地开发。" },
      ],
    },
  },
];

const profile: SearchData = { profiles: profileItems };

test("只有画像时召回也不为空", () => {
  const text = renderRecall(profile);
  assert.match(text, /用户画像：Tim 同时做 Web 前端和 pi 后端/);
  assert.match(text, /技术栈：前端用 React 和 TypeScript/);
  assert.doesNotMatch(text, /profile_tim/);
});

test("画像和条目一起出现，条目排在画像后面", () => {
  const text = renderRecall({ ...data, profiles: profileItems });
  assert.ok(text.indexOf("用户画像") < text.indexOf("测试习惯"));
  assert.match(text, /事实：Tim stated/);
});

test("画像吃掉的预算不挤掉条目", () => {
  const long: SearchData = {
    profiles: [
      {
        profile_data: {
          summary: "画像".repeat(400),
          explicit_info: [{ category: "技术栈", description: "说明".repeat(200) }],
        },
      },
    ],
    episodes,
  };
  const text = renderRecall(long, 500);
  assert.ok(text.length <= 560, `实际长度 ${text.length}`);
  assert.match(text, /测试习惯/);
});

const listed: GetData = {
  episodes: [
    {
      id: "ep_1",
      subject: "测试习惯",
      summary: "Tim 一直用 pnpm 跑测试。",
      timestamp: "2026-10-02T12:00:00.000+08:00",
    },
  ],
  total_count: 12,
  count: 1,
};

test("列举 episode 给出总数和本页条数", () => {
  const text = renderList(listed, "episode");
  assert.match(text, /共 12 条，本页 1 条/);
  assert.match(text, /2026-10-02 测试习惯/);
  assert.doesNotMatch(text, /ep_1/);
});

test("列举 episode 空的时候说清楚是没记忆还是页码超了", () => {
  assert.equal(renderList({ total_count: 0 }, "episode"), "还没有记忆。");
  assert.match(renderList({ total_count: 12 }, "episode"), /页码超出范围/);
});

test("列举画像直接给画像，没有页码概念", () => {
  const text = renderList({ profiles: profileItems }, "profile");
  assert.match(text, /用户画像：Tim 同时做 Web 前端和 pi 后端/);
  assert.equal(renderList({}, "profile"), "还没有画像。画像由 EverOS 自己提炼，攒够对话才会有。");
});
