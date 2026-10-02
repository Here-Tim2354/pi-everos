/**
 * 日志。扩展在后台跟着每一轮跑，失败必须留下痕迹，又不能反复弹提示，
 * 所以统一写文件，由调用方决定什么时候提醒用户一次。
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** 排查问题只看这一个文件。 */
export const LOG_FILE = `${getAgentDir()}/pi-everos.log`;

const MAX_BYTES = 512 * 1024;

/** 写日志本身不抛错：磁盘写不进去也不该打断会话。 */
export function log(level: "info" | "warn" | "error", message: string): void {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    rotate();
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`, {
      mode: 0o600,
    });
  } catch {
    return;
  }
}

/** 超限整体挪到 .1，不按行裁剪，避免留下半行。 */
function rotate(): void {
  try {
    if (statSync(LOG_FILE).size > MAX_BYTES) {
      renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch {
    return; // 文件还不存在。
  }
}
