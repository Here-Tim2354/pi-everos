/**
 * 配置。四层覆盖：命令行标志 > 环境变量 > 配置文件 > 默认值。
 * 配置文件在 pi 的用户目录下，里面有令牌，写成 0600。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { projectIdFromCwd, type Scope, sanitizeId } from "./scope.js";

export const CONFIG_FILE = `${getAgentDir()}/pi-everos.json`;

/** 可覆盖的字段。三个来源（标志、环境变量、文件）形状相同，未设的值一律是 undefined。 */
export interface Overrides {
  baseUrl?: string | undefined;
  token?: string | undefined;
  ca?: string | undefined;
  insecure?: boolean | undefined;
  appId?: string | undefined;
  projectId?: string | undefined;
  userId?: string | undefined;
  recall?: boolean | undefined;
  commit?: boolean | undefined;
  topK?: number | undefined;
}

export interface Config extends Scope {
  baseUrl: string;
  token: string;
  /** 自签证书的 PEM 文件路径。 */
  ca: string | undefined;
  /** 跳过证书校验。自签又不想拷证书时才用。 */
  insecure: boolean;
  /** 会话开始召回一次并冻结。整场不变，前缀缓存才不会被反复打掉。 */
  recall: boolean;
  /** 每轮把新增对话提交给 EverOS。 */
  commit: boolean;
  topK: number;
  timeoutMs: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_TOP_K = 5;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_APP_ID = "pi";

export function loadConfig(cwd: string, flags: Overrides = {}): Config {
  const stored = readStoredConfig();
  const username = safeUsername();

  return {
    baseUrl: first(flags.baseUrl, env("EVEROS_BASE_URL"), stored.baseUrl) ?? DEFAULT_BASE_URL,
    token: first(flags.token, env("EVEROS_TOKEN"), stored.token) ?? "",
    ca: first(flags.ca, env("EVEROS_CA_FILE"), stored.ca),
    insecure: first(flags.insecure, flag("EVEROS_INSECURE"), stored.insecure) ?? false,
    appId: sanitizeId(first(flags.appId, env("EVEROS_APP_ID"), stored.appId) ?? DEFAULT_APP_ID, "pi"),
    projectId: sanitizeId(
      first(flags.projectId, env("EVEROS_PROJECT_ID"), stored.projectId) ?? projectIdFromCwd(cwd),
      "default",
    ),
    userId: sanitizeId(first(flags.userId, env("EVEROS_USER_ID"), stored.userId) ?? username, "user"),
    recall: first(flags.recall, stored.recall) ?? true,
    commit: first(flags.commit, stored.commit) ?? true,
    topK: first(flags.topK, stored.topK) ?? DEFAULT_TOP_K,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

/** 不可用时返回原因，用于提示用户。空字符串表示没问题。 */
export function configProblem(config: Config): string | undefined {
  try {
    const url = new URL(config.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `服务器地址的协议必须是 http 或 https：${config.baseUrl}`;
    }
  } catch {
    return `服务器地址不是合法 URL：${config.baseUrl}`;
  }
  return undefined;
}

/** 令牌只用来显示，不写进日志。 */
export function maskToken(token: string): string {
  if (token === "") return "（未配置）";
  return `${token.slice(0, 6)}…（${token.length} 位）`;
}

export function readStoredConfig(): Overrides {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Overrides;
  } catch {
    return {};
  }
}

/** 合并写回，让 /memory-setup 能分次补字段。 */
export function writeStoredConfig(patch: Overrides): Overrides {
  const merged = { ...readStoredConfig(), ...patch };
  for (const key of Object.keys(merged) as Array<keyof Overrides>) {
    if (merged[key] === undefined) delete merged[key];
  }
  writeFileSync(CONFIG_FILE, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  return merged;
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function flag(name: string): boolean | undefined {
  const value = env(name)?.toLowerCase();
  if (value === undefined) return undefined;
  return value === "1" || value === "true" || value === "yes";
}

function first<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function safeUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return "user";
  }
}
