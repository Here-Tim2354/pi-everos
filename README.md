# pi-everos

给 [pi](https://github.com/earendil-works/pi) 的长期记忆扩展，后端是 [EverOS](https://everos.evermind.ai)。
跨会话记住偏好、事实、决定和踩过的坑，不用每次重新解释背景。

## 它做什么

| 时机 | 行为 |
|---|---|
| 会话开头 | 拿你的第一句话去检索一次，把命中的片段注入系统提示。整场会话用同一段文字，前缀缓存不会被打掉 |
| 每一轮结束 | 把上一轮之后新增的对话提交给 EverOS。提炼与否由 EverOS 自己判断，pi 这边不做取舍 |
| 会话结束 | 等提交落地，再催一次提炼，保证最后一轮不丢 |
| 随时 | 提供 `memory_search`（主动查）和 `memory_add`（主动记）两个工具 |

对话内容不落 pi 的本地文件，只发给你配置的那台 EverOS。服务是否加密、存在哪、备份策略，都由你的部署决定。

## 安装

```bash
pi install npm:pi-everos          # 用户级
pi install -l npm:pi-everos       # 只在本项目生效
```

从源码装：

```bash
pi install /path/to/pi-everos
```

## 连接

只需要三样东西：

| 信息 | 从哪来 |
|---|---|
| 服务器地址 | 部署的人给你，例如 `https://your-server:8443` |
| 令牌 | 部署时设的那个 |
| 证书文件 | 自签证书才要，服务器上的 `certs/server.crt` |

在 pi 里运行：

```
/memory-setup
```

按提示填三项，它会先请求一次健康检查，通了才写配置。配置落在 `~/.pi/agent/pi-everos.json`，权限 0600。

走 EverOS 官方云只需要一个 API Key；本地直连 `http://127.0.0.1:8000` 的 EverOS 不需要令牌。

查看当前状态：

```
/memory-status
```

## 配置项

环境变量优先于配置文件，命令行标志优先于环境变量。

| 环境变量 | 配置文件字段 | 默认值 | 说明 |
|---|---|---|---|
| `EVEROS_BASE_URL` | `baseUrl` | `http://127.0.0.1:8000` | 服务器地址 |
| `EVEROS_TOKEN` | `token` | 空 | 网关校验的令牌 |
| `EVEROS_CA_FILE` | `ca` | 空 | 自签证书路径 |
| `EVEROS_INSECURE` | `insecure` | `false` | 跳过证书校验，只在本机调试时用 |
| `EVEROS_USER_ID` | `userId` | 系统用户名 | 记忆挂在谁名下 |
| `EVEROS_APP_ID` | `appId` | `pi` | 应用标识 |
| `EVEROS_PROJECT_ID` | `projectId` | 工作目录名 | 记忆按项目分开 |
| — | `recall` | `true` | 关掉就不自动召回 |
| — | `commit` | `true` | 关掉就不自动提交 |

命令行标志：`--everos-url`、`--everos-token`、`--everos-ca`、`--everos-insecure`。

`appId`、`projectId`、`userId` 只接受字母、数字、下划线、点、短横线。中文目录名会被压成合法形式并补一段短哈希，同一个目录每次都算得出同一个值。

## 失败了会怎样

- 每一轮的提交失败：写日志，退回上次确认的位置，下一轮连同这批一起重发。
- 召回失败：会话开头重试，最多三次，之后本场不再试。
- 提示只弹一次，其余写进 `~/.pi/agent/pi-everos.log`。
- 服务连不上不影响 pi 的其他功能，扩展静默降级，对话照常。

上下文被压缩之后，锚点可能已经不在上下文里。这时宁可跳过一轮不提交，也不重发，避免记忆里出现重复条目。

## 排查

| 现象 | 先看什么 |
|---|---|
| 记忆一直是空的 | `/memory-status` 看服务器是否连得上，再看日志里的提交记录 |
| 提示证书错误 | 配置 `ca` 指向 `server.crt`，或临时用 `--everos-insecure` |
| 记忆里出现重复 | 检查是不是同一台机器换了 `projectId`，或会话被 fork 过 |
| 想把某个项目排除掉 | `--everos-commit=false` 或配置文件里设 `commit: false` |

## 开发

```bash
npm install
npm run verify      # 类型检查加测试
npm run check       # Biome
npx tsx scripts/smoke.ts   # 连真实服务器跑一遍
```

跑 smoke 需要环境变量：

```bash
EVEROS_BASE_URL=https://your-server:8443 \
EVEROS_TOKEN=xxx \
EVEROS_CA_FILE=/path/to/server.crt \
npx tsx scripts/smoke.ts
```

## 许可

MIT。EverOS 本身由 EverMind 开发，单独授权。
