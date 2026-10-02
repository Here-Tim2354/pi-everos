<div align="center">

# pi-everos

给 [pi](https://github.com/earendil-works/pi) 加一层长期记忆，后端是 [EverOS](https://everos.evermind.ai)。

跨会话记住偏好、事实、决定和踩过的坑。

[![license](https://img.shields.io/github/license/Here-Tim2354/pi-everos?style=flat-square)](LICENSE)
[![stars](https://img.shields.io/github/stars/Here-Tim2354/pi-everos?style=flat-square)](https://github.com/Here-Tim2354/pi-everos/stargazers)
[![node](https://img.shields.io/badge/node-%E2%89%A5%2022.19-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![pi](https://img.shields.io/badge/pi-extension-2563eb?style=flat-square)](https://github.com/earendil-works/pi)
[![EverOS](https://img.shields.io/badge/memory-EverOS-7c3aed?style=flat-square)](https://everos.evermind.ai)

<img src="https://raw.githubusercontent.com/Here-Tim2354/pi-everos/main/docs/architecture.png" alt="pi 接入 EverOS：四个挂点、两个工具、一个访问网关" width="880">

<sub>把 EverOS 当一个整体看，只关心接缝。它内部怎么分层、怎么写盘、怎么建索引，与本扩展无关。</sub>

</div>

---

## 它做什么

| 时机 | 行为 |
| :--- | :--- |
| 会话开头 | 拿你的第一句话检索一次，把命中的片段注入系统提示 |
| 每一轮结束 | 把上一轮之后新增的对话提交给 EverOS |
| 会话结束 | 等提交落地，必要时催一次提炼 |
| 随时 | 提供 `memory_search`（主动查）和 `memory_add`（主动记）两个工具 |

提炼时机由 EverOS 自己判断：`/add` 只是把消息放进缓冲区，边界探测器觉得这段对话告一段落了才跑模型。pi 这边不做取舍，也不为每轮对话付一次模型钱。

## 装上

```bash
pi install git:github.com/Here-Tim2354/pi-everos
```

只对当前项目生效加 `-l`，试用一次加 `-e` 前缀。npm 上的包发布后可以直接 `pi install npm:pi-everos`。

## 连上你的 EverOS

需要三样东西：

| 信息 | 从哪来 | 例子 |
| :--- | :--- | :--- |
| 服务器地址 | 部署的人给你 | `https://your-server:8443` |
| 令牌 | 部署时设的 | 一串十六进制 |
| 证书文件 | 自签证书才需要 | 服务器上的 `certs/server.crt` |

在 pi 里运行 <kbd>/memory-setup</kbd>，按提示填。它会先请求一次健康检查，通了才写配置，配置文件落在 `~/.pi/agent/pi-everos.json`，权限 0600。

状态随时可查：

```
/memory-status
```

<sub>走 EverOS 官方云只需要一个 API Key。本地直连 `http://127.0.0.1:8000` 的 EverOS 不需要令牌。</sub>

## 配置

环境变量优先于配置文件，命令行标志优先于环境变量。

| 环境变量 | 配置文件字段 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `EVEROS_BASE_URL` | `baseUrl` | `http://127.0.0.1:8000` | 服务器地址 |
| `EVEROS_TOKEN` | `token` | 空 | 网关校验的令牌 |
| `EVEROS_CA_FILE` | `ca` | 空 | 自签证书路径 |
| `EVEROS_INSECURE` | `insecure` | `false` | 跳过证书校验，只用于本机调试 |
| `EVEROS_USER_ID` | `userId` | 系统用户名 | 记忆挂在谁名下 |
| `EVEROS_APP_ID` | `appId` | `pi` | 应用标识 |
| `EVEROS_PROJECT_ID` | `projectId` | 工作目录名 | 记忆按项目分开 |
| — | `recall` | `true` | 关掉就不自动召回 |
| — | `commit` | `true` | 关掉就不自动提交 |

<details>
<summary>命令行标志</summary>

| 标志 | 作用 |
| :--- | :--- |
| `--everos-url` | 本次运行覆盖地址 |
| `--everos-token` | 本次运行覆盖令牌 |
| `--everos-ca` | 本次运行覆盖证书路径 |
| `--everos-insecure` | 本次运行跳过证书校验 |

<sub>`appId`、`projectId`、`userId` 只接受字母、数字、下划线、点和短横线。中文目录名会被压成合法形式并补一段短哈希，同一个目录每次算出的值相同。</sub>

</details>

## 它记什么，不记什么

- **记**：你说过的事实、偏好、决定、约定、踩过的坑。
- **不记**：工具输出、思考过程、系统提示。工具结果连提交都不会发生，只有你和助手的文字会出去。
- **不该记**：密码、令牌、密钥、证件号。这条写在扩展自带的技能里，模型会被提醒。

对话内容只发给你配的那台 EverOS。它是否加密、存在哪块盘、怎么备份，由你的部署决定，本扩展不做额外落盘，本地只写一份日志。

## 出问题的时候

| 现象 | 处理 |
| :--- | :--- |
| 提交失败 | 写日志，退回上次服务端确认的位置，下一轮连同这批一起重发 |
| 召回失败 | 会话开头重试，最多三次，之后本场不再试 |
| 上下文被压缩 | 锚点不在上下文里了就跳过一轮，不重发，避免记忆里出现重复 |
| 服务连不上 | 静默降级，pi 其他功能照常，提示只弹一次 |
| 退出时卡一下 | 缓冲区还有没提炼的内容，最多等 10 秒催出来，状态栏有提示 |

日志在 `~/.pi/agent/pi-everos.log`。

<details>
<summary>更多排查</summary>

| 症状 | 先看什么 |
| :--- | :--- |
| 记忆一直是空的 | `/memory-status` 看服务器是否连得上，再看日志里的提交记录 |
| 提示证书错误 | 配置 `ca` 指向 `server.crt`，或临时用 `--everos-insecure` |
| 记忆里出现重复 | 检查是不是同一台机器换了 `projectId`，或会话被 fork 过 |
| 想让某个项目不写记忆 | 配置文件里设 `commit: false` |

</details>

## 开发

```bash
npm install
npm run verify     # 类型检查加测试
npm run check      # Biome
```

连真实服务器跑一遍：

```bash
EVEROS_BASE_URL=https://your-host:8443 \
EVEROS_TOKEN=xxx \
EVEROS_CA_FILE=/path/to/server.crt \
npx tsx scripts/smoke.ts
```

目录结构：

```text
src/
  index.ts    四个挂点、两个命令、接线
  client.ts   HTTP 客户端
  config.ts   配置四层覆盖
  delta.ts    增量切片
  tools.ts    两个工具
  format.ts   检索结果渲染
  scope.ts    作用域 id 清洗
  log.ts      日志
skills/
  memory-usage/SKILL.md   教模型什么时候该查、什么时候该记
```

## 参与贡献

欢迎提 issue 和 PR。先读 [CONTRIBUTING.md](CONTRIBUTING.md)

## 许可

MIT，见 [LICENSE](LICENSE)。

EverOS 由 EverMind 开发，单独授权；本仓库只包含 pi 侧的扩展代码。
