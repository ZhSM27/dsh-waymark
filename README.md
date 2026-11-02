# Waymark · 路标

DeepSeek Harness 的本地 Agent 工作流程优化插件：从已保存会话中定位重复尝试、重复读取、大输出与用户纠偏，给出带证据的复盘和可审核的 AGENTS.md 候选规则。

**v0.1.0 本地候选版**。Phase 2–3 已实现；历史八项发现获用户认同后，已按未归档限制完成子代理补充复核，目前有中断分类及纠偏边界线索待跟进。尚未公开发布。仅适配并验证 **dsh 0.2.1-rc.5**；dsh 是开发者预览，升级可能破坏接口。

## 安装

v0.2 开发中已加入 observe/warn 和生产归档准入。已在 Codex 内置浏览器用本地 DeepSeek key 验证原生命令、R1/R3 提醒送达和仅用户可见模式，见 [浏览器验收](docs/BROWSER-ACCEPTANCE.md) 与 [范围记录](docs/LIVE-VALIDATION.md)。当前不提供自动拦截。

需要 Node.js 24.11+（实测 24.22.2）和 pnpm 9.15.0。包名为 `dsh-waymark`，npm 同名是否可用需发布前重新检查；目前不要运行 registry 安装命令。

从本项目构建：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
pnpm build
pnpm check:build
pnpm check:package
```

本地 tgz 生成到 `.research/packages/dsh-waymark-0.1.0.tgz`。在装有匹配版本 dsh 的终端安装到 web profile：

```sh
dsh plugin --profile web add -w ./dsh-waymark-0.1.0.tgz
dsh --profile web --dump-config
dsh web
```

开发目录可用 `dsh plugin --profile web add -w .`。`-w` 是本次 pnpm 9.15.0 在 dsh 生成的 profile workspace 中所需的显式根标志；若使用不同版本，按实际 CLI 行为核实。安装后重启 dsh。卸载：`dsh plugin --profile web remove -w dsh-waymark`，随后重启。

安装须选择实际运行的 profile；本次验收使用隔离 web profile，未改动用户原有 profile，未验证 Desktop/TUI 的 UI 呈现。

## 使用

```text
/waymark retro
/waymark retro last
/waymark retro <session-id>
/waymark retro <session-id> --json
/waymark retro <session-id> --markdown
/waymark retro <session-id> --export review.md
```

省略 id 分析当前会话。`last` 选择与当前会话 **cwd 完全匹配**、已保存的最近顶层会话，排除当前会话和 subagent；按创建时间排序，不代表最近修改时间。没有 cwd 或匹配记录时要求显式 id，不悄悄扫描其他项目。

`--json` 返回完整 Report 对象；`--markdown` 返回完整 Markdown；`--export` 显式写入接收命令的工作目录下 `.waymark/reports/<filename>`。三种模式互斥。导出只接受简单 `.md` 文件名，拒绝覆盖、路径穿越和目录链接。完整报告可能含本地路径及用户纠偏片段，分享前自行脱敏。

命令直接返回结果，不调用模型、不把复盘再塞入模型上下文。dsh 自身会保存 command/run、command/done 和结果文本；这不等于宿主运行时磁盘零写入。Waymark 不重写被分析的日志，不自动编辑 AGENTS.md 或配置。

## 报告示例

以下为独立合成示例，不来源于真实会话：

```text
Waymark · 会话 synthetic-example · 共 1 轮
发现 1 项；疑似可避免的重复内容：0 token（内容计数）

[R3 巨型输出] 第 1 轮 · seq 8–8
  read 输出约 5.0k token（估算）。
  建议规则：按任务需要先搜索或限制输出范围，只保留相关片段；确需完整输出时保留。
```

大输出不自动等同于浪费，因此上述可避免总额仍为零。`pnpm demo` 可运行完全合成的失败循环演示。

## 规则与证据

| 规则 | 判定 | 主要边界 |
|---|---|---|
| R1 重复失败 | 同工具、相同/近似参数、相同错误的连续失败，默认三次 | 其他工具或解释边界会保守切段；并发失败不冒充重试 |
| R2 重复读取 | 同文件、相同范围/内容的成功读取默认三次 | 观察到成功 write/edit 后重置；外部编辑与 shell 写入未完整覆盖 |
| R3 巨型输出 | 结果体积严格大于 4000 token，并列出 Top 5 | 体积不证明无用；不直接加进可避免总额 |
| R4 用户纠偏 | 上次人工输入后有工具活动，真实用户消息命中词表 | 低置信度；可能是正常改需求；只展示前 80 个 Unicode 字符 |

报告包含轮次/seq 证据、工具成败、有限形式的验证命令观察和最多三条去重的项目级规则提案。验证命令只识别简单 npm/pnpm/yarn/bun 的 test/build/lint/typecheck 形式；不从未观察到推断没有验证，不宣称任务已完成。

shell 失败按已安装工具契约解释：isError 不覆盖全部命令非零退出，bash/pwsh 文本标记只作为中等强度依据。后台、超时、中断和 Windows pwsh 的不确定 exit 1 保守处理。未知状态不计失败。

内容 token 缺失时用 Unicode 字符数 / 4 粗估，中文与不同 tokenizer 可有明显偏差。重复体积仅计算第一次之后的调用及输出，按调用去重；模型请求 usage 单独列出。分母是提取文本/推理/调用参数的体积，排除媒体、工具 schema 等，不能称为账单节省或当前窗口占比。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖 `waymark` 行的 config；重启生效。该插件自行严格校验，不提供额外设置 UI。dsh patch 会替换整行 config，修改时保留需要的全部选项。

```yaml
- id: waymark
  config:
    failLoopMin: 3
    rereadMin: 3
    similarityThreshold: 0.8
    bigOutputTokens: 4000
    topN: 5
    volatileArgumentKeys: []
    temporaryPathPrefixes: []
    correctionKeywords: ['不对', '停', '重来', '撤销', '搞错', 'revert', 'undo', 'stop', 'wrong']
```

| 字段 | 默认 | 约束与含义 |
|---|---|---|
| failLoopMin | 3 | 至少 2 的整数，R1 最小次数 |
| rereadMin | 3 | 至少 2 的整数，R2 最小次数 |
| similarityThreshold | 0.8 | `(0, 1]`，字符二元组 Dice；不是语义相似度 |
| bigOutputTokens | 4000 | 非负有限数，严格超出才触发 R3 |
| topN | 5 | 正整数，输出排行榜长度 |
| volatileArgumentKeys | [] | 递归忽略的参数键；明确开启才丢弃 |
| temporaryPathPrefixes | [] | 临时根前缀，建议带结尾分隔符；保留相对目标名 |
| correctionKeywords | 上述中英文词表 | 非空字符串数组；空数组禁用 R4；英文匹配词边界 |

未知配置键会报错。默认保留数字、时间戳与路径，避免合并不同任务。

## 验证与隐私

核心零运行依赖，所有单元测试夹具独立合成。真实会话经官方只读查询服务处理；不会向网络上传，也不调用 LLM、遥测、压缩、记忆归档或自动阻断。宿主及其他插件的网络行为不属于 Waymark。

参考插件的能力方向已融入统一的 Audit/Diagnose/Evidence/Improve/Evaluate 流程；没有捆绑执行第三方插件。实时 Guard、上下文压缩、Obsidian/博客发布、Claude Code/Codex 适配不在 v0.1。

历史十会话批次检测到八项 R3，用户于 2026-11-02 确认全部认同，该批用户认同率为 8/8（100%），没有触发低于 50% 的阈值重测条件。R1/R2/R4 未触发；原十四个未报告片段后来按新增归档限制筛除并重建，不再整体使用。该历史结果不代表普遍准确率、召回率或实际节省，逐项反馈及证据仅保留本地。

以上为历史批次。用户新增“不得使用归档会话”限制后，本轮已先排除 7 条归档和 2 条不支持的历史格式，仅使用 15 条合格会话重建材料。两个子代理复核 12 个未报告窗口、32 个定向候选，发现 1 条低置信度纠偏漏报线索和 1 处中断分类疑点。历史整体认同率不作本轮指标，规则效果仍有限制；见 [未归档专项结果](docs/UNARCHIVED-REVIEW.md)。

生产命令已接入宿主 workspaceRegistry 归档准入，当前、显式 id、last 和导出均排除归档或未登记会话；状态不可确认时拒绝处理。last 仅读同工作区已获准候选。旧研究脚本仍拒绝直接读用户会话根。

## 实时观察与提醒（开发中）

```text
/waymark guard status
/waymark guard mode observe
/waymark guard mode warn
/waymark guard delivery user
/waymark guard delivery model
/waymark guard feedback 1 helpful
/waymark guard mode off
```

默认 off，按当前会话开启。observe 只计数，warn 提供 R1/R3 提示；不拒绝或自动重试工具。默认 delivery=model，提示会随宿主下一次模型请求发送；delivery=user 将提示留在本地 status，不进入模型上下文。状态和反馈只在内存，重启不保留。通知 id、seq 证据、次数与估算提示成本可在 status 查看。PTC 子调用和继承会话暂不覆盖。

profile 的 waymark config 可增加 `live: {failWarnMin: 2, bigOutputTokens: 4000, maxPerSession: 5, maxChars: 400}`。failWarnMin 至少 2；maxPerSession 为 1–100 整数；maxChars 为 150–4000 整数；bigOutputTokens 为非负有限数，缺省沿用离线同名阈值。每轮最多一条，独立于离线 failLoopMin。未知 live 键拒绝。

- [接口与核心口径](docs/CORE.md)
- [dsh 字段依据](docs/SCHEMA.md)
- [Phase 2–4 验收及未完成项](docs/PHASE2-4.md)
- [发布清单](docs/RELEASE.md)
- [历史执行计划](docs/PLAN.md)

MIT License。尚未 push、publish 或设置远端 GitHub topic。
