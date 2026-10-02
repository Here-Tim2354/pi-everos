# 变更记录

本文件记录所有值得注意的改动。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-10-02

### 新增

- 会话开头召回一次并冻结注入；整场会话用同一段文字，前缀缓存不受影响
- 每轮结束增量提交新增对话，只发上次之后的部分
- 会话结束等提交落地，缓冲区非空时催一次提炼
- `memory_search` 与 `memory_add` 两个工具
- `/memory-setup` 与 `/memory-status` 两个命令
- 随包发布的 `memory-usage` 技能
- 提交位置写进会话条目，重开同一会话时接着上次继续

### 说明

- 工具输出、思考过程、系统提示都不提交
- 不引入运行时依赖；HTTP 走 `node:https`，以便接受自签证书
- 提交失败退回上次确认的位置，下一轮连同这批重发
