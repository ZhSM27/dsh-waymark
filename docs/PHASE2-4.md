# Phase 2–4 验收记录

## Phase 2：接入通过

- dsh 适配仅按实际安装的 0.2.1-rc.5 公共契约，格式版本 4；官方 sessionQuery 读取，CLI bundle 安装。
- 注册 /waymark retro，支持当前、明确 id 和同 cwd 最近保存会话。
- 原生命令服务成功分析真实保存记录；接收侧为独立内存 Session 和最小接收 Agent 结构，产生两个命令生命周期事件，没有写回原日志。
- 插件安装到隔离 DSH_HOME 的 web profile，组合配置成功，Web 服务成功绑定 loopback，启动日志未出现错误；测试结束停止自建服务。
- 这不是浏览器端截图验收，不宣称已在用户原 Desktop profile 或 UI 全流程测试。
- 读取前后规范源日志内容摘要一致；未调用模型，没有复制原始日志进项目或夹具。

## Phase 3：功能通过

R2/R4、词表与阈值校验、JSON、完整 Markdown、显式本地文件导出已实现。导出不覆盖文件，不改 AGENTS.md，拒绝目录链接与路径穿越。工具统计、保守的验证命令识别、最多三条去重规则提案已纳入报告。

已知限制：R2 仅识别已核对的 read/write/edit，不能看见所有外部写入；R4 仅为低置信度提示。shell 文本标记可能由输出伪造；pwsh 不确定 exit 1 不计失败。R1 仍是保守连续段，不是完整语义进展分析。

## Phase 4：八项发现已获人工认同，漏报抽查待完成

真实样本：最近十个已保存顶层会话（按创建时间）。原生读取成功，源日志摘要未变。发现八项 R3，另外三条规则没有触发。准备了十四个未报告片段作为漏报抽查。包括 fork 继承内容时保留说明，不能把跨会话体积简单相加。

| 规则 | 发现数 | 已人工判定 | 认同比例 | 结论 |
|---|---:|---:|---|---|
| R1 | 0 | 0 | 不可计算 | 无发现样本，不能评价召回率 |
| R2 | 0 | 0 | 不可计算 | 无发现样本，不能评价召回率 |
| R3 | 8 | 8 | 100%（8/8） | 用户确认全部认同；本批无需触发低于 50% 的阈值重测 |
| R4 | 0 | 0 | 不可计算 | 无发现样本，不能评价召回率 |

2026-11-02，用户针对上一轮八项发现明确回复“均认同”。已将这八项 R3 逐条记录为 agree：agree=8、disagree=0、uncertain=0、pending=0，按 agree/(agree+disagree) 得到 100%。这是本批大输出提示的用户认同率，不是所有规则的普遍准确率、召回率或实际 token 节省证明。未调整阈值，也没有触发低于 50% 的收紧重测条件。

本次回复未明确覆盖十四个未报告片段的漏报抽查，故继续保留待完成状态；R1/R2/R4 没有发现样本，仍不能评价其效果。原始待评议表、用户反馈依据和更新后逐项判断均留在本地忽略目录，未将真实会话正文纳入版本库。

本地材料在 git 忽略的 `.research/review/baseline/`：review.md、review.json、sNN-report.md、sNN-evidence.md、controls.json、manifest.json。证据节选可能含私人内容，仅保留本地。统计命令：`node scripts/review-status.mjs .research/review/baseline/review.json`。

## 复现检查

使用 Node 24.22.2、pnpm 9.15.0，执行 README 中 typecheck/test/build/check:build/check:package。独立核心类型检查不加载 Node/DOM 类型；模块图测试约束核心不得导入外部模块。合成测试覆盖四条规则、正常迭代、并发、错误配对、估算、关键词、导出、配置、人工评议统计与未判定处理。

最终合成测试 57/57 通过。ESM 与类型声明构建、构建产物烟测通过；tgz 内容白名单检查通过，只有 lib/docs/README/LICENSE/manifest/patch，没有测试夹具、原始会话或本地调研目录。实际 tgz 已替换 link 安装到隔离 profile，原生文本、JSON、Markdown、显式导出及卸载清理通过，源规范日志摘要保持一致。完整 Web 启动另已验收，但未进行浏览器交互自动化。

发布元数据已准备 MIT、0.1.0、keywords 和精确 engines.dsh。保留 private:true 防止未经确认发布。GitHub 远端尚未指定，topic dsh-plugin 仍在发布清单中。八项发现的认同不等于发布授权，也不表示零样本规则或漏报检查已通过。
