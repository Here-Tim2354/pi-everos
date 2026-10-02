/**
 * EverOS 客户端。只碰四个接口：
 *   GET  /health
 *   POST /api/v2/memory/add     消息进缓冲区
 *   POST /api/v2/memory/flush   立刻提炼这个会话的缓冲区
 *   POST /api/v2/memory/search  检索
 * 用 node:http(s) 而不是 fetch，因为自签证书得传自定义 CA。
 */
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";

import type { Config } from "./config.js";
import type { Scope } from "./scope.js";

export interface MessageItem {
  sender_id: string;
  role: "user" | "assistant" | "tool";
  timestamp: number;
  content: string;
}

export interface HealthData {
  status?: string;
  version?: string;
  capabilities?: Record<string, boolean>;
  disabled_features?: string[];
}

export interface AtomicFact {
  id?: string;
  content: string;
  score?: number;
}

export interface MemoryItem {
  id?: string;
  subject?: string;
  summary?: string;
  episode?: string;
  timestamp?: string;
  score?: number;
  atomic_facts?: AtomicFact[];
}

export interface SearchData {
  episodes?: MemoryItem[];
  profiles?: MemoryItem[];
  agent_cases?: MemoryItem[];
  agent_skills?: MemoryItem[];
}

export interface AddResult {
  message_count?: number;
  status?: string;
}

export interface FlushResult {
  status?: string;
}

export class EverosError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "EverosError";
    this.code = code;
  }
}

export class EverosClient {
  readonly #config: Config;

  constructor(config: Config) {
    this.#config = config;
  }

  health(signal?: AbortSignal): Promise<HealthData> {
    return this.#request<HealthData>("/health", undefined, signal);
  }

  /** 同一 (session_id, app_id, project_id) 的消息会攒成一批，攒够了 EverOS 自己提炼。 */
  add(
    scope: Scope,
    sessionId: string,
    messages: readonly MessageItem[],
    signal?: AbortSignal,
  ): Promise<AddResult> {
    return this.#request<AddResult>(
      "/api/v2/memory/add",
      {
        session_id: sessionId,
        app_id: scope.appId,
        project_id: scope.projectId,
        messages,
      },
      signal,
    );
  }

  /** 强制提炼当前缓冲区。缓冲区空了会回 no_extraction，不算失败。 */
  flush(scope: Scope, sessionId: string, signal?: AbortSignal): Promise<FlushResult> {
    return this.#request<FlushResult>(
      "/api/v2/memory/flush",
      { session_id: sessionId, app_id: scope.appId, project_id: scope.projectId },
      signal,
    );
  }

  search(
    scope: Scope,
    query: string,
    options: { topK: number; method?: "keyword" | "vector" | "hybrid" | "agentic" | undefined },
    signal?: AbortSignal,
  ): Promise<SearchData> {
    return this.#request<SearchData>(
      "/api/v2/memory/search",
      {
        user_id: scope.userId,
        app_id: scope.appId,
        project_id: scope.projectId,
        query,
        method: options.method ?? "hybrid",
        top_k: options.topK,
      },
      signal,
    );
  }

  #request<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, this.#config.baseUrl);
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
    const options: RequestOptions = {
      method: payload === undefined ? "GET" : "POST",
      headers: this.#headers(payload),
      timeout: this.#config.timeoutMs,
    };

    if (url.protocol === "https:") {
      try {
        if (this.#config.ca !== undefined) {
          options.ca = readFileSync(this.#config.ca);
        }
      } catch (error) {
        return Promise.reject(
          new EverosError(`读不到证书文件 ${this.#config.ca}：${text(error)}`, "CA_UNREADABLE"),
        );
      }
      options.rejectUnauthorized = !this.#config.insecure;
    }

    return new Promise<T>((resolve, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = send(url, options, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 0;
          const parsed = parseJson(body);
          if (status < 200 || status >= 300) {
            reject(new EverosError(describeStatus(status, parsed, body), `HTTP_${status}`));
            return;
          }
          resolve(unwrap(parsed) as T);
        });
      });

      request.on("timeout", () => {
        request.destroy(new EverosError(`请求超时（${this.#config.timeoutMs} 毫秒）`, "TIMEOUT"));
      });
      request.on("error", (error: Error) => {
        reject(error instanceof EverosError ? error : new EverosError(describeNetwork(error), "NETWORK"));
      });

      if (signal !== undefined) {
        const abort = () => request.destroy(new EverosError("请求已取消", "ABORTED"));
        if (signal.aborted) {
          abort();
        } else {
          signal.addEventListener("abort", abort, { once: true });
          request.on("close", () => signal.removeEventListener("abort", abort));
        }
      }

      if (payload !== undefined) request.write(payload);
      request.end();
    });
  }

  #headers(payload: Buffer | undefined): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (payload !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(payload.length);
    }
    if (this.#config.token !== "") {
      headers.authorization = `Bearer ${this.#config.token}`;
    }
    return headers;
  }
}

/** 业务接口把结果包在 data 里，/health 不包，所以取不到就用原样。 */
function unwrap(parsed: unknown): unknown {
  if (parsed !== null && typeof parsed === "object" && "data" in parsed) {
    return (parsed as { data: unknown }).data;
  }
  return parsed;
}

function parseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 业务错误的信封是 { error: { code, message } }，网关和框架的错误不是。 */
function describeStatus(status: number, parsed: unknown, body: string): string {
  const envelope = parsed as { error?: { code?: string; message?: string } } | undefined;
  const message = envelope?.error?.message;
  if (message !== undefined) {
    const code = envelope?.error?.code;
    return `EverOS 返回 ${status}${code === undefined ? "" : ` [${code}]`}：${message}`;
  }
  const trimmed = body.trim();
  return trimmed === "" || trimmed.length > 120
    ? `EverOS 返回 ${status}`
    : `EverOS 返回 ${status}：${trimmed}`;
}

const NETWORK_HINTS: Record<string, string> = {
  ECONNREFUSED: "连接被拒绝，服务没起来或地址写错了",
  ECONNRESET: "连接被重置",
  ENOTFOUND: "域名解析不了",
  ETIMEDOUT: "连接超时",
  DEPTH_ZERO_SELF_SIGNED_CERT: "证书是自签的，配置 ca 指向 server.crt，或改用 insecure",
  SELF_SIGNED_CERT_IN_CHAIN: "证书链里有自签证书，配置 ca",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "证书链不完整，配置 ca",
  CERT_HAS_EXPIRED: "证书过期了，服务器上重新签发",
};

function describeNetwork(error: Error): string {
  const code = (error as NodeJS.ErrnoException).code;
  const hint = code === undefined ? undefined : NETWORK_HINTS[code];
  return hint === undefined ? `请求失败：${error.message}` : `请求失败：${hint}（${code}）`;
}

function text(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
