# Waymark · 路标

DeepSeek Harness 的本地 Agent 工作流程优化插件。拟发布包名：`dsh-waymark`。

目标：把会话证据转成流程诊断、可审核的行为建议，并在后续会话验证效果。

Phase 0 调研完成，尚无可安装的 Waymark 插件。已验证 dsh `0.2.1-rc.5` 的只读会话探针，插件安装与规则测试留待后续阶段；开发者预览可能发生破坏性变更。

详见 [执行计划](docs/PLAN.md)、[会话契约](docs/SCHEMA.md) 与 [决策记录](NOTES.md)。

[Phase 0 验收结果](docs/PHASE0.md) · [调研环境复现](research/README.md)

插件运行期全部在本地处理，不主动调用模型、不上传会话。调研及安装开发依赖需要网络。不会自动修改 AGENTS.md、配置或压缩会话。
