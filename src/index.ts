/**
 * 接线。四个时机各管一件事：
 *   session_start       读配置，恢复上次提交到哪
 *   before_agent_start  首次提问时召回一次并冻结，之后每轮注入同一段
 *   turn_end            提交本轮新增的对话
 *   session_shutdown    等提交落地，再催一次提炼
 * 自动流程之外还有两个命令和两个工具。
 */
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import { EverosClient, EverosError, type MessageItem, type SearchData } from "./client.js";
import {
  CONFIG_FILE,
  type Config,
  configProblem,
  loadConfig,
  maskToken,
  type Overrides,
  readStoredConfig,
  writeStoredConfig,
} from "./config.js";
import { deltaAfter, type Turn, toMessageItems } from "./delta.js";
import { renderRecall } from "./format.js";
import { LOG_FILE, log } from "./log.js";
import type { Scope } from "./scope.js";
import { createTools } from "./tools.js";

const AGENT_ID = "pi";
/** 我们在会话文件里存提交位置的条目类型。 */
const COMMIT_ENTRY = "pi-everos-commit";
/** 系统提示里的段落名，pi 会用它做标签。 */
const RECALL_SECTION = "memory";
const MAX_RECALL_ATTEMPTS = 3;
const SHUTDOWN_GRACE_MS = 5_000;

interface SessionState {
  config: Config;
  /** 配置有问题或还没连上时为 undefined，此时所有自动行为静默关闭。 */
  client: EverosClient | undefined;
  /** 服务端已确认收到的锚点。 */
  committed: string | undefined;
  /** 已排队的锚点，可能还没落地。 */
  queued: string | undefined;
  /** undefined 表示还没查过召回，"" 表示查过但没命中。 */
  recall: string | undefined;
  recallAttempts: number;
  /** 一场会话里只弹一次提示，日志照写。 */
  notified: boolean;
  /** 提交串成一条链，保证顺序，也方便退出前等它散完。 */
  pending: Promise<void>;
}

export default function everosMemory(pi: ExtensionAPI): void {
  pi.registerFlag("everos-url", { description: "本次运行覆盖 EverOS 地址", type: "string" });
  pi.registerFlag("everos-token", { description: "本次运行覆盖 EverOS 令牌", type: "string" });
  pi.registerFlag("everos-ca", { description: "自签证书 PEM 路径", type: "string" });
  pi.registerFlag("everos-insecure", { description: "跳过证书校验", type: "boolean" });

  const sessions = new Map<string, SessionState>();
  const overrides = (): Overrides => ({
    baseUrl: text(pi.getFlag("everos-url")),
    token: text(pi.getFlag("everos-token")),
    ca: text(pi.getFlag("everos-ca")),
    insecure: pi.getFlag("everos-insecure") === true ? true : undefined,
  });

  const warn = (state: SessionState, ctx: ExtensionContext, message: string): void => {
    log("warn", message);
    if (state.notified || !ctx.hasUI) return;
    state.notified = true;
    ctx.ui.notify(`EverOS 记忆：${message}（日志 ${LOG_FILE}）`, "warning");
  };

  /** 任务串到链尾，前一个失败也照跑。返回值给调用方，链尾永远不 reject。 */
  const queue = <T>(state: SessionState, task: () => Promise<T>): Promise<T> => {
    const run = state.pending.then(task, task);
    state.pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const post = (
    state: SessionState,
    ctx: ExtensionContext,
    messages: readonly MessageItem[],
  ): Promise<void> =>
    queue(state, async () => {
      if (state.client === undefined) throw new EverosError("还没连上 EverOS", "NOT_CONNECTED");
      const result = await state.client.add(scopeOf(state), sessionId(ctx), messages, ctx.signal);
      log("info", `提交 ${messages.length} 条，缓冲区 ${result.message_count ?? "?"} 条`);
    });

  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig(ctx.cwd, overrides());
    const problem = configProblem(config);
    const state: SessionState = {
      config,
      client: problem === undefined ? new EverosClient(config) : undefined,
      committed: restoreAnchor(ctx),
      queued: undefined,
      recall: undefined,
      recallAttempts: 0,
      notified: false,
      pending: Promise.resolve(),
    };
    state.queued = state.committed;
    sessions.set(sessionId(ctx), state);

    if (problem !== undefined) {
      warn(state, ctx, `${problem}。运行 /memory-setup 连接 EverOS。`);
      return;
    }
    log("info", `连接 ${config.baseUrl}，作用域 ${config.appId}/${config.projectId}，用户 ${config.userId}`);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const state = sessions.get(sessionId(ctx));
    if (state?.client === undefined || !state.config.recall) return;

    if (state.recall === undefined && state.recallAttempts < MAX_RECALL_ATTEMPTS) {
      state.recallAttempts += 1;
      try {
        const data = await state.client.search(
          scopeOf(state),
          event.prompt,
          { topK: state.config.topK },
          ctx.signal,
        );
        state.recall = renderRecall(data);
        log("info", `召回 ${countItems(data)} 条`);
      } catch (error) {
        warn(state, ctx, `召回失败：${describe(error)}`);
      }
    }

    // 整场会话注入同一段文字，前缀缓存才不会每轮被作废。
    if (state.recall !== undefined && state.recall !== "") {
      event.systemPromptOptions.sections[RECALL_SECTION] = state.recall;
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    const state = sessions.get(sessionId(ctx));
    if (state?.client === undefined || !state.config.commit) return;

    const delta = deltaAfter(turnsFrom(ctx.sessionManager.buildContextEntries()), state.queued);
    if (delta.lostAnchor) {
      log("warn", "上下文被压缩过，锚点不在了，本轮跳过提交");
    }
    if (delta.turns.length === 0) return;

    const anchor = delta.anchor;
    state.queued = anchor;
    post(state, ctx, toMessageItems(delta.turns, owner(state)))
      .then(() => {
        state.committed = anchor;
        pi.appendEntry(COMMIT_ENTRY, { anchor });
      })
      .catch((error: unknown) => {
        // 退回已确认位置，下一轮连同这批一起重发。
        state.queued = state.committed;
        warn(state, ctx, `提交失败：${describe(error)}`);
      });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const id = sessionId(ctx);
    const state = sessions.get(id);
    if (state === undefined) return;
    sessions.delete(id);

    await withTimeout(state.pending, SHUTDOWN_GRACE_MS);
    if (state.client === undefined) return;

    // 缓冲区里可能还剩最后一轮，催一次提炼。服务端要跑一次模型，等不回来就算了。
    const done = await withTimeout(
      state.client
        .flush(scopeOf(state), id)
        .then(() => true)
        .catch((error: unknown) => {
          log("warn", `退出前提炼失败：${describe(error)}`);
          return false;
        }),
      SHUTDOWN_GRACE_MS,
    );
    log("info", done === true ? "退出前已催提炼" : "退出前来不及催提炼，缓冲区留在服务端");
  });

  for (const tool of createTools((ctx) => {
    const state = sessions.get(sessionId(ctx));
    const client = state?.client;
    if (state === undefined || client === undefined) return undefined;
    return {
      search: (query, topK, method, signal) => client.search(scopeOf(state), query, { topK, method }, signal),
      remember: (content) =>
        post(state, ctx, [{ sender_id: state.config.userId, role: "user", timestamp: Date.now(), content }]),
    };
  })) {
    pi.registerTool(tool);
  }

  pi.registerCommand("memory-setup", {
    description: "连接 EverOS：填地址、令牌、证书，并验证一次",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        log("warn", "非交互模式无法配置，请手写配置或用环境变量");
        return;
      }

      const stored = readStoredConfig();
      const baseUrl = await ctx.ui.input("EverOS 地址", stored.baseUrl ?? "https://127.0.0.1:8443");
      if (baseUrl === undefined) return;
      const token = await ctx.ui.input("令牌（EverOS 前面没有网关就留空）", "Bearer token");
      if (token === undefined) return;
      const ca = await ctx.ui.input("证书路径（自签才填，可留空）", "E:\\path\\to\\server.crt");
      if (ca === undefined) return;

      const patch = { baseUrl, token, ca: blank(ca) };
      const config = loadConfig(ctx.cwd, patch);
      const problem = configProblem(config);
      if (problem !== undefined) {
        ctx.ui.notify(problem, "error");
        return;
      }

      try {
        const health = await new EverosClient(config).health();
        writeStoredConfig(patch);
        ctx.ui.notify(`连上了：EverOS ${health.version ?? "?"}，配置写入 ${CONFIG_FILE}`, "info");
        log("info", `配置已写入 ${CONFIG_FILE}，版本 ${health.version ?? "?"}`);
      } catch (error) {
        ctx.ui.notify(`连不上：${describe(error)}`, "error");
      }
    },
  });

  pi.registerCommand("memory-status", {
    description: "查看当前记忆配置和服务器状态",
    handler: async (_args, ctx) => {
      const config = loadConfig(ctx.cwd, overrides());
      const lines = [
        `地址：${config.baseUrl}`,
        `令牌：${maskToken(config.token)}`,
        `证书：${config.ca ?? "（未配置）"}`,
        `作用域：${config.appId} / ${config.projectId}`,
        `用户：${config.userId}`,
        `自动召回：${config.recall ? "开" : "关"}，自动提交：${config.commit ? "开" : "关"}`,
      ];
      try {
        const health = await new EverosClient(config).health();
        lines.push(`服务器：${health.status ?? "?"} ${health.version ?? ""}`.trim());
      } catch (error) {
        lines.push(`服务器：连不上（${describe(error)}）`);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

function sessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function scopeOf(state: SessionState): Scope {
  return { userId: state.config.userId, appId: state.config.appId, projectId: state.config.projectId };
}

function owner(state: SessionState): { userId: string; agentId: string } {
  return { userId: state.config.userId, agentId: AGENT_ID };
}

/** 把上下文里的消息摊平成待提交的轮次。系统消息不进记忆。 */
function turnsFrom(entries: readonly SessionEntry[]): Turn[] {
  const turns: Turn[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as WireMessage;
    const role = roleOf(message.role);
    if (role === undefined) continue;
    const text = messageText(message).trim();
    if (text === "") continue;
    turns.push({
      entryId: entry.id,
      role,
      text,
      timestamp:
        typeof message.timestamp === "number" && message.timestamp > 0 ? message.timestamp : Date.now(),
    });
  }
  return turns;
}

/** 消息种类是开放联合，按字段名取值，不依赖具体类型。 */
interface WireMessage {
  role?: unknown;
  timestamp?: unknown;
  content?: unknown;
}

function roleOf(role: unknown): Turn["role"] | undefined {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "toolResult") return "tool";
  return undefined;
}

/** 只取文字。思考过程、工具调用和带外的自定义消息都不进记忆。 */
function messageText(message: WireMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: string; text?: string }) =>
      part?.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .filter((part) => part !== "")
    .join("\n");
}

/** 从会话文件里读回上次提交位置，接着上次继续，避免重发整场对话。 */
function restoreAnchor(ctx: ExtensionContext): string | undefined {
  const entries: readonly SessionEntry[] = ctx.sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== COMMIT_ENTRY) continue;
    const anchor = (entry.data as { anchor?: unknown } | undefined)?.anchor;
    if (typeof anchor === "string") return anchor;
  }
  return undefined;
}

async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([task, expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function countItems(data: SearchData): number {
  return (data.episodes?.length ?? 0) + (data.profiles?.length ?? 0);
}

function describe(error: unknown): string {
  if (error instanceof EverosError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function text(value: boolean | string | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function blank(value: string): string | undefined {
  return value.trim() === "" ? undefined : value.trim();
}
