/**
 * 三个工具：主动查、主动记、摊开看。自动召回加自动提交已经覆盖大部分场景，
 * 前两个留给模型补刀：查当前对话没提过的事，和纠正已经过时的说法。
 * 第三个是审计口：写了什么能看全，不用猜查询词。
 */
import { defineTool, type ExtensionToolContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";

import type { GetData, MemoryType, SearchData } from "./client.js";
import { renderList, renderSearch } from "./format.js";

export type SearchMethod = "keyword" | "vector" | "hybrid";

/** 查、记、列举。连不上时 resolve 返回 undefined，由工具报错给模型。 */
export interface ToolDeps {
  search(
    query: string,
    topK: number,
    method: SearchMethod | undefined,
    signal?: AbortSignal,
  ): Promise<SearchData>;
  remember(content: string): Promise<void>;
  list(memoryType: MemoryType, page: number, pageSize: number, signal?: AbortSignal): Promise<GetData>;
}

type AnyTool = ToolDefinition<TSchema, unknown, unknown>;

export function createTools(resolve: (ctx: ExtensionToolContext) => ToolDeps | undefined): AnyTool[] {
  return [searchTool(resolve), addTool(resolve), listTool(resolve)];
}

function searchTool(resolve: (ctx: ExtensionToolContext) => ToolDeps | undefined): AnyTool {
  return defineTool({
    name: "memory_search",
    label: "查长期记忆",
    description: "检索长期记忆里与 query 相关的内容。当前对话没提到、但以前聊过的，用这个查。",
    parameters: Type.Object({
      query: Type.String({ description: "用一句完整的话说清要查什么" }),
      top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "返回条数，默认 5" })),
      method: Type.Optional(
        Type.Union([Type.Literal("keyword"), Type.Literal("vector"), Type.Literal("hybrid")], {
          description: "默认 hybrid，关键词和向量一起用",
        }),
      ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (_callId, params, signal, _onUpdate, ctx) => {
      const deps = requireDeps(resolve, ctx);
      const data = await deps.search(params.query, params.top_k ?? 5, params.method, signal);
      const count = countItems(data);
      return {
        content: [{ type: "text", text: renderSearch(data) }],
        details: { count },
      };
    },
  });
}

function addTool(resolve: (ctx: ExtensionToolContext) => ToolDeps | undefined): AnyTool {
  return defineTool({
    name: "memory_add",
    label: "写入长期记忆",
    description:
      "把值得跨会话保留的事实写进长期记忆。日常对话每轮已自动提交，只在要明确记下、或纠正过时说法时调用。记忆只能追加，纠正靠再写一条明确陈述。",
    parameters: Type.Object({
      content: Type.String({
        description: "带主语和时态的事实陈述，例如「Tim 决定部署只用 Docker，不引入别的依赖」",
      }),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    execute: async (_callId, params, _signal, _onUpdate, ctx) => {
      const deps = requireDeps(resolve, ctx);
      await deps.remember(params.content);
      return {
        content: [{ type: "text", text: "已提交，稍后由 EverOS 提炼入库。" }],
        details: { queued: true },
      };
    },
  });
}

function listTool(resolve: (ctx: ExtensionToolContext) => ToolDeps | undefined): AnyTool {
  return defineTool({
    name: "memory_list",
    label: "浏览长期记忆",
    description:
      "按时间倒序列出长期记忆的条目，不做语义检索。用户问「你记得什么」、要核对记忆里存了什么、或怀疑检索漏了的时候用这个。",
    parameters: Type.Object({
      memory_type: Type.Union([Type.Literal("episode"), Type.Literal("profile")], {
        description: "episode 是对话提炼的条目，profile 是用户画像（只有一个）",
      }),
      page: Type.Optional(Type.Integer({ minimum: 1, description: "页码，默认 1" })),
      page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "每页条数，默认 10" })),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (_callId, params, signal, _onUpdate, ctx) => {
      const deps = requireDeps(resolve, ctx);
      const data = await deps.list(params.memory_type, params.page ?? 1, params.page_size ?? 10, signal);
      const count =
        params.memory_type === "profile" ? (data.profiles?.length ?? 0) : (data.episodes?.length ?? 0);
      return {
        content: [{ type: "text", text: renderList(data, params.memory_type) }],
        details: { count },
      };
    },
  });
}

/** 抛错就是工具失败，模型能读到原因。 */
function requireDeps(
  resolve: (ctx: ExtensionToolContext) => ToolDeps | undefined,
  ctx: ExtensionToolContext,
): ToolDeps {
  const deps = resolve(ctx);
  if (deps === undefined) {
    throw new Error("EverOS 记忆还没连上，先让用户运行 /memory-setup。");
  }
  return deps;
}

function countItems(data: SearchData): number {
  return (data.episodes?.length ?? 0) + (data.profiles?.length ?? 0);
}
