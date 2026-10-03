/**
 * 三种渲染。召回片段进系统提示，要短；工具结果给模型看，可以详细一点；
 * 列举结果按类型分两种形状。冲突规则只在召回段的抬头写一次，两处都写就成两个源了。
 */
import type { GetData, MemoryItem, MemoryType, ProfileItem, SearchData } from "./client.js";

const RECALL_BUDGET = 1500;
const TOOL_BUDGET = 1500;
/** 召回段里画像单独限一块，免得把 episode 挤没。 */
const PROFILE_BUDGET = 400;
const TITLE_LIMIT = 120;

export function renderRecall(data: SearchData, budget = RECALL_BUDGET): string {
  const profile = renderProfile(data.profiles, PROFILE_BUDGET);
  const entries = collect(data);
  if (entries.length === 0 && profile === "") return "";

  const lines: string[] = [];
  for (const entry of entries) {
    const title = [entry.when, entry.title].filter((part) => part !== "").join(" ");
    const body = entry.body === entry.title ? "" : entry.body;
    lines.push(`- ${title}${body === "" ? "" : `：${body}`}`);
    for (const fact of entry.facts) {
      lines.push(`  事实：${fact}`);
    }
  }

  const header = "与当前话题相关的旧记忆（可能过时，冲突时以当前对话为准）：";
  // 画像和抬头先占位，剩下的预算给 episode，免得画像把条目挤没。
  const used = header.length + 1 + (profile === "" ? 0 : profile.length + 1);
  const body = truncate(lines.join("\n"), Math.max(budget - used, 0));
  return [header, profile, body].filter((part) => part !== "").join("\n");
}

export function renderSearch(data: SearchData): string {
  const profile = renderProfile(data.profiles, TOOL_BUDGET);
  const entries = collect(data);
  if (entries.length === 0 && profile === "") return "没有命中记忆。";

  const blocks = entries.map((entry, index) => {
    const title = [entry.when, entry.title].filter((part) => part !== "").join(" ");
    const lines = [`[${index + 1}] ${title}`];
    if (entry.body !== "" && entry.body !== entry.title) {
      lines.push(`    摘要：${entry.body}`);
    }
    if (entry.facts.length > 0) {
      lines.push(`    事实：${entry.facts.join("；")}`);
    }
    return lines.join("\n");
  });

  const parts: string[] = [];
  if (profile !== "") parts.push(profile);
  if (blocks.length > 0) parts.push(`命中 ${entries.length} 条记忆：\n\n${blocks.join("\n\n")}`);
  return parts.join("\n\n");
}

/** 列举结果。profile 只有一个，没有页码可言。 */
export function renderList(data: GetData, memoryType: MemoryType): string {
  if (memoryType === "profile") {
    const profile = renderProfile(data.profiles, TOOL_BUDGET);
    return profile === "" ? "还没有画像。画像由 EverOS 自己提炼，攒够对话才会有。" : profile;
  }

  const episodes = data.episodes ?? [];
  if (episodes.length === 0) {
    const total = data.total_count ?? 0;
    return total === 0 ? "还没有记忆。" : "这一页是空的，页码超出范围了。";
  }

  const blocks = episodes.map((item, index) => {
    const when = (item.timestamp ?? "").slice(0, 10);
    const subject = condense(item.subject);
    const summary = condense(item.summary);
    const title = [when, subject === "" ? summary : subject].filter((part) => part !== "").join(" ");
    const extra = summary === "" || summary === subject ? "" : `\n    摘要：${summary}`;
    return `[${index + 1}] ${title}${extra}`;
  });

  const total = data.total_count ?? episodes.length;
  return `共 ${total} 条，本页 ${episodes.length} 条：\n\n${blocks.join("\n\n")}`;
}

interface Entry {
  when: string;
  title: string;
  body: string;
  facts: string[];
}

function collect(data: SearchData): Entry[] {
  return (data.episodes ?? []).map(toEntry);
}

function toEntry(item: MemoryItem): Entry {
  const subject = condense(item.subject);
  const summary = condense(item.summary);
  return {
    when: (item.timestamp ?? "").slice(0, 10),
    title: subject === "" ? summary : subject,
    body: summary,
    facts: (item.atomic_facts ?? [])
      .map((fact) => condense(fact.content))
      .filter((fact) => fact !== "")
      .slice(0, 2),
  };
}

/** 画像压成两行：一句概述，加上若干条已知信息。 */
function renderProfile(profiles: readonly ProfileItem[] | undefined, budget: number): string {
  const data = profiles?.[0]?.profile_data;
  if (data === undefined) return "";

  const summary = condense(data.summary, 200);
  const known = (data.explicit_info ?? [])
    .map((item) => {
      const label = condense(item.category ?? item.trait, 20);
      const text = condense(item.description);
      if (text === "") return "";
      return label === "" ? text : `${label}：${text}`;
    })
    .filter((item) => item !== "")
    .slice(0, 3);

  const lines: string[] = [];
  if (summary !== "") lines.push(`用户画像：${summary}`);
  if (known.length > 0) lines.push(`已知：${known.join("；")}`);
  return truncate(lines.join("\n"), budget);
}

/** 压成一行，按预算截断。 */
function condense(value: string | undefined, limit = TITLE_LIMIT): string {
  const line = (value ?? "").replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

/** 在预算内的最后一个换行处截断，不留半行。预算不够一行时给空串。 */
function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.lastIndexOf("\n", budget);
  if (cut === -1) return "";
  return `${text.slice(0, cut)}\n（其余片段已省略）`;
}
