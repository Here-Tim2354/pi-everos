/**
 * 增量提交。每轮只把上次之后新增的对话发给 EverOS。
 * 锚点是会话条目 id：上下文被压缩后锚点可能消失，这时宁可少发一轮也不重发，
 * 否则记忆里会出现重复条目。
 */
import type { MessageItem } from "./client.js";

export interface Turn {
  entryId: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export interface Delta {
  turns: Turn[];
  /** 下一轮的比较基准。 */
  anchor: string | undefined;
  /** 锚点已不在当前上下文里，说明中间的内容被压缩掉了。 */
  lostAnchor: boolean;
}

export function deltaAfter(turns: readonly Turn[], anchor: string | undefined): Delta {
  if (anchor === undefined) {
    return { turns: [...turns], anchor: lastId(turns), lostAnchor: false };
  }

  const index = turns.findIndex((turn) => turn.entryId === anchor);
  if (index === -1) {
    return { turns: [], anchor, lostAnchor: true };
  }

  const fresh = turns.slice(index + 1);
  return { turns: fresh, anchor: lastId(fresh) ?? anchor, lostAnchor: false };
}

export function toMessageItems(
  turns: readonly Turn[],
  owner: { userId: string; agentId: string },
): MessageItem[] {
  return turns.map((turn) => ({
    // assistant 的 sender_id 只是给提炼模型看的，不决定落盘位置。
    sender_id: turn.role === "assistant" ? owner.agentId : owner.userId,
    role: turn.role,
    timestamp: turn.timestamp,
    content: turn.text,
  }));
}

function lastId(turns: readonly Turn[]): string | undefined {
  return turns.at(-1)?.entryId;
}
