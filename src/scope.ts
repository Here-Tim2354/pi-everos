/**
 * 作用域 id。EverOS 用 app_id / project_id 分目录存放记忆，
 * 用 sender_id 决定一条消息算在谁名下，
 * 三个字段都只接受 [A-Za-z0-9_.-]，长度 1–128，且拒绝 "." 与 ".."。
 */
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

const ILLEGAL = /[^A-Za-z0-9_.-]+/g;
const MAX_LENGTH = 128;

export interface Scope {
  userId: string;
  appId: string;
  projectId: string;
}

/**
 * 压成合法 id。同一个仓库每次都要算出同一个值，改名等于换一份记忆。
 * 中文名会被清空，所以清洗有损时补一段短哈希，避免两个仓库撞成同一个 id。
 */
export function sanitizeId(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "..") {
    return fallback;
  }

  const cleaned = trimmed.replace(ILLEGAL, "-").replace(/^-+|-+$/g, "");
  if (cleaned === "" || cleaned === "." || cleaned === "..") {
    return `${fallback}-${shortHash(trimmed)}`;
  }

  const shaped = cleaned === trimmed ? cleaned : `${cleaned}-${shortHash(trimmed)}`;
  return shaped.slice(0, MAX_LENGTH);
}

/** 项目 id 取工作目录名。这里不查 git，免得在钩子里起进程。 */
export function projectIdFromCwd(cwd: string): string {
  return sanitizeId(basename(resolve(cwd)), "default");
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 6);
}
