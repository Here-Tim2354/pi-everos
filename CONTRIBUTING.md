# 参与贡献

## 环境

- Node ≥ 22.19（pi 的要求）
- npm
- 想跑真实链路的话，一台能连上的 EverOS

```bash
git clone https://github.com/Here-Tim2354/pi-everos
cd pi-everos
npm install
```

## 常用命令

| 命令 | 作用 |
| :--- | :--- |
| `npm run verify` | 类型检查加测试，提交前必跑 |
| `npm run test` | 只跑测试 |
| `npm run typecheck` | 只跑类型检查 |
| `npm run check` | Biome 检查 |
| `npm run format` | Biome 自动修复 |

## 代码规范

- TypeScript 严格模式，`exactOptionalPropertyTypes` 打开。可选字段写成 `| undefined`，不要用 `!` 断言绕过。
- 不引入运行时依赖。pi 运行时自带的包写进 `peerDependencies`，范围用 `*`。
- HTTP 走 `node:https`，不用 `fetch`：自签证书要传自定义 CA。
- 注释用中文，讲清为什么这么做。一眼能看懂的代码不加注释。
- 面向模型的文本（工具描述、技能说明）写成完整的句子，不要堆术语。

## 测试

- 纯函数（增量切片、id 清洗、结果渲染）必须有测试，放在 `test/` 下。
- 网络行为用假数据或 mock，不要连别人的 EverOS 写测试数据。
- 需要真实链路时用 `scripts/smoke.ts`，它只往一个临时会话里写。

## 提交信息

用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，正文写中文，说清问题和取舍：

```text
fix: 工具结果不再提交给 EverOS

role=tool 的行服务端要求带 tool_call_id，缺了整批 422。
工具输出本来也不该进长期记忆，直接跳过。
```

标题一行，动词开头，一个提交只做一件事。

## 提 PR

1. 从 `main` 切分支，名字用 `fix/xxx` 或 `feat/xxx`。
2. 跑 `npm run verify` 和 `npm run check`。
3. 按模板填描述：改了什么、为什么改、怎么验证的。
4. CI 全绿之后等 review。

## 这些改法会被拒绝

下面几条不是口味问题，是会破坏现有保证的：

| 改法 | 为什么不行 |
| :--- | :--- |
| 每轮把整段对话重发一遍 | 服务端按缓冲区增量处理，重发会造成重复入库 |
| 每轮重新召回并替换注入的段落 | 系统提示一变，前缀缓存整段作废，之后每次都按全价计费 |
| 用 `forceSystemPrompt` 或直接替换 `systemPrompt` | 同上，还会丢掉 pi 的结构化段落 |
| 把失败吞掉不写日志 | 记忆是后台行为，出错没人看见等于数据静默丢失 |
| 引入 HTTP 客户端或日志库 | 扩展跑在 pi 进程里，依赖越多越容易和宿主冲突 |
| 提交工具输出或思考过程 | 服务端不接受没有 `tool_call_id` 的工具行，这些内容对长期记忆也没有价值 |
| 把令牌写到配置文件以外的位置 | 令牌是明文，只放在权限 0600 的配置文件或环境变量里 |

## 新增配置项时

- 三个来源都要接上：命令行标志、环境变量、配置文件。
- 在 README 的配置表里补一行。
- 默认值要保守。默认开启的自动行为必须对用户有明确好处。

## 拿不准的时候

先开 issue 把场景说清楚，别闷头写。
