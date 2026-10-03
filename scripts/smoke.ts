/**
 * 连真实服务器跑一遍：健康检查 → 提交 → 提炼 → 检索 → 列举。
 *
 * 用法（自签证书要给 ca）：
 *   EVEROS_BASE_URL=https://your-server:8443 \
 *   EVEROS_TOKEN=xxx \
 *   EVEROS_CA_FILE=/path/to/server.crt \
 *   npx tsx scripts/smoke.ts
 */
import { type MemoryItem, EverosClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig(process.cwd());
const client = new EverosClient(config);
const scope = { userId: config.userId, appId: config.appId, projectId: config.projectId };
const sessionId = `smoke-${Date.now()}`;

const health = await client.health();
const on = Object.entries(health.capabilities ?? {})
  .filter(([, enabled]) => enabled)
  .map(([name]) => name)
  .join("、");
console.log(`健康检查：${health.status ?? "?"} ${health.version ?? ""}，可用能力 ${on}`);

const now = Date.now();
const added = await client.add(scope, sessionId, [
  {
    sender_id: config.userId,
    role: "user",
    timestamp: now,
    content: "smoke test: my favorite editor is Zed.",
  },
  {
    sender_id: config.userId,
    role: "user",
    timestamp: now + 1000,
    content: "smoke test: the server sits in Guangzhou.",
  },
]);
console.log(`提交 ${added.message_count ?? "?"} 条，状态 ${added.status ?? "?"}`);

const flushed = await client.flush(scope, sessionId);
console.log(`提炼：${flushed.status ?? "?"}`);

// 覆盖索引同步有几秒延迟。
await new Promise((resolve) => setTimeout(resolve, 6000));

const found = await client.search(scope, "which editor does the user like", { topK: 3 });
console.log(`检索命中 ${count(found.episodes)} 条 episode、${count(found.profiles)} 条画像`);
for (const episode of found.episodes ?? []) {
  console.log(`- ${episode.subject ?? "(无标题)"}`);
}

const withProfile = await client.search(scope, "用户画像", { topK: 1, includeProfile: true });
console.log(`带画像检索：${withProfile.profiles?.[0]?.profile_data?.summary ?? "（还没有画像）"}`);

const episodes = await client.get(scope, { memoryType: "episode", pageSize: 5 });
console.log(`列举 episode：共 ${episodes.total_count ?? "?"} 条，本页 ${count(episodes.episodes)} 条`);

const profile = await client.get(scope, { memoryType: "profile" });
console.log(`列举画像：${count(profile.profiles)} 条`);

function count(items: MemoryItem[] | undefined): number {
  return items?.length ?? 0;
}
