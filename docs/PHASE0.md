# Phase 0 验收记录

日期：2026-11-01。状态：完成，等待用户确认进入 Phase 1。

## 交付

- 项目 Waymark（路标），候选包名 `dsh-waymark`，拟定命令空间 `/waymark`。
- 扩展路线图：Audit / Diagnose / Evidence / Improve / Evaluate；Guard 为后续待设计模块。每阶段确认要求保持有效。
- 安装 dsh `0.2.1-rc.5`、Node `24.22.2`，使用 pnpm `9.15.0`；隔离在 git 忽略目录，未修改用户 dsh profile。
- 审查官方 README、打包与命令文档、安装包类型和实现；参考 dsh-balance 的入口/manifest/patch 与 dsh-session-audit 的命令/工具入口。
- `docs/SCHEMA.md`：真实字段、失败语义、用量、存储、接口漂移、合成示例与限制。
- `scripts/probe-session.mjs`：官方只读接口的真实会话计数探针。
- `research/package.json`、`research/pnpm-lock.yaml`：固定调研依赖；`docs/phase0-artifacts.json`：关键安装包源码 SHA-256。

## 真实会话读取

在本机已有保存会话上运行，无模型请求、未展示或复制正文。已读取到内存的逻辑日志统计：

```json
{
  "dshVersion": "0.2.1-rc.5",
  "logicalFormatVersion": 4,
  "total": 351,
  "counts": {
    "user": 9,
    "assistant": 38,
    "tool_call": 47,
    "tool_result": 47,
    "other": 210
  },
  "sourceUnchanged": true
}
```

这里的 user 是 `user/message` 类别总数，不是已经筛选出的人工提示数；other 包含边界、请求等日志事件，不能忽略其解释作用。此阶段没有生成诊断报告或质量判断。真实会话 id、路径、正文不进入版本库。

## 检查

- CLI `--version`：0.2.1-rc.5。
- 合成事件计数测试：3/3，通过；覆盖空日志、四类事件、其他日志记录。未测试生产规则（尚未实现）。
- Node `--check`：探针语法通过。
- `git diff --check`：通过。
- 真实读取完成，源规范日志前后内容摘要一致。

## 同类和命名

`dsh-retro` npm 名已占用，uckkk/dsh-retro 与 StellatoL/retro 存在。`dsh-session-audit` 与原提案明显重叠；已报告给用户，用户随后确认扩展为综合优化插件继续推进。GitHub dsh-plugin topic 已浏览；不宣称生态穷尽或功能独占。

`dsh-waymark` 查询返回 npm 404；GitHub AgentWaymark 精确名称搜索无结果。`agent-waymark` 已有包，不使用。查询未占用不等于名称保留或商标审查。

参考链接（未复制第三方实现进入生产源码）：

- https://github.com/andregoncalves/dsh-balance
- https://github.com/bwndlct/dsh-session-audit
- https://github.com/GooDAnDReaDY/dsh-agent-loop-guard
- https://github.com/030611/dsh-context-provenance
- https://github.com/StellatoL/retro
- https://github.com/topics/dsh-plugin

整合遵循独立模块与统一事件/证据层；尚未授权或实施自动压缩、自动规则写入、博客发布或运行中阻断。复用代码之前再次核对具体文件许可。

## 限制与偏差

- 安装上游依赖存在 OTel peer 告警：部分 OTel 包要求 API `<1.10.0`，解析得到 `1.10.0`；本探针未挂载 OTel，所用路径通过，不代表上游问题已修复。
- 最初探针清理调用误用了不存在的 Context.dispose，随后查阅安装 Cordis 类型改为持有 plugin fiber 并调用 fiber.dispose；以最终通过版本为准。
- 线上 master 文档的 snapshot.location 不存在于安装基线；已删除该依赖并记录差异。
- 单个真实会话读取不证明所有历史格式、完整 web profile、规则准确性或模型表现改善。
- 本仓库未配置作者身份，本地提交显式使用 Codex <codex@localhost>，不改全局 Git 配置，不冒用用户身份。
- 尚无 Waymark 功能插件，不提供安装自身的命令；未进入 Phase 1。
