# Waymark · 路标

DeepSeek Harness 的本地 Agent 工作流程优化插件。拟发布包名：`dsh-waymark`。

目标：把会话证据转成流程诊断、可审核的行为建议，并在后续会话验证效果。

Phase 1 核心完成，尚无可安装的 Waymark 插件。已实现零 dsh 运行依赖的 R1/R3 与纯报告渲染；33 项测试、类型检查、构建和构建产物检查通过。dsh `0.2.1-rc.5` 仅验证了 Phase 0 只读探针，正式适配与命令安装留到 Phase 2；开发者预览可能发生破坏性变更。

详见 [执行计划](docs/PLAN.md)、[会话契约](docs/SCHEMA.md) 与 [决策记录](NOTES.md)。

[Phase 0 验收结果](docs/PHASE0.md) · [调研环境复现](research/README.md)

[Phase 1 验收结果](docs/PHASE1.md) · [核心 API 与判定口径](docs/CORE.md)

## 开发与合成演示

Node 24.11+（实测 24.22.2）、pnpm 9.15.0：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
pnpm build
pnpm check:build
pnpm demo
```

演示全部为独立合成数据，不读取真实会话；部分 token 数是夹具显式指定的内容计数。core 本身没有文件、网络或模型操作。开发依赖仅 TypeScript 和 tsdown；保留 Node 原生测试器，未额外引入测试框架。

## 当前检测能力

- R1：同一工具的相同或相似参数、相同错误，默认至少三次连续失败；仅计算首次之后的调用与输出。诊断工具、编辑、用户消息、显式边界及中断会分段，并发调用不冒充重试。
- R3：工具输出按体积列前五项，超过 4000 token 标记；每项保留 seq/turn/step 证据。大输出不直接加入可避免总额。
- 缺少逐事件计数时，按 Unicode 字符数 / 4 粗估，明确标注；请求用量另列，未知不当零。

相似度是启发式，R1 尚不构成完整的语义进展判定。正常修复迭代通过合成反例测试，但仍需 Phase 4 的人工真实会话验证。

插件运行期全部在本地处理，不主动调用模型、不上传会话。调研及安装开发依赖需要网络。不会自动修改 AGENTS.md、配置或压缩会话。
