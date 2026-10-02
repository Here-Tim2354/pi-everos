/**
 * 检索结果的两种渲染。召回片段进系统提示，要短；工具结果给模型看。
 * 冲突规则只在召回段的抬头写一次，两处都写就成两个源了。
 */
import type { MemoryItem, SearchData } from "./client.js";

const RECALL_BUDGET = 1500;
const TITLE_LIMIT = 120;

export function renderRecall(data: SearchData, budget = RECALL_BUDGET): string {
  const entries = collect(data);
  if (entries.length === 0) return "";

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
  return truncate(`${header}\n${lines.join("\n")}`, budget);
}

export function renderSearch(data: SearchData): string {
  const entries = collect(data);
  if (entries.length === 0) return "没有命中记忆。";

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

  return `命中 ${entries.length} 条记忆：\n\n${blocks.join("\n\n")}`;
}

interface Entry {
  when: string;
  title: string;
  body: string;
  facts: string[];
}

function collect(data: SearchData): Entry[] {
  return [...(data.episodes ?? []), ...(data.profiles ?? [])].map(toEntry);
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

/** 压成一行，按预算截断。 */
function condense(value: string | undefined, limit = TITLE_LIMIT): string {
  const line = (value ?? "").replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

/** 在预算内的最后一个换行处截断，不留半行。 */
function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.lastIndexOf("\n", budget);
  return `${text.slice(0, cut === -1 ? budget : cut)}\n（其余片段已省略）`;
}
