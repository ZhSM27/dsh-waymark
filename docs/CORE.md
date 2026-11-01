# Phase 1 核心 API

## 分层

`src/core/index.ts` 导出 Event/SessionInput/Report 等类型、DEFAULT_CONFIG、resolveConfig、analyzeSession、renderReport、renderMarkdown、summarizeReview。core 的导入全部位于 core 内；无 dsh、Node、文件系统、网络或模型依赖。API 接收内存数据，返回结构化报告与文本。构建产物为 `lib/core/index.js` 和 `index.d.ts`；独立宿主入口在 `src/plugin.ts`，不属于核心。

```ts
import { analyzeSession, renderReport } from './src/core/index.ts';

const report = analyzeSession({
  id: 'synthetic-session',
  scope: 'full-log',
  events: [],
});
const text = renderReport(report);
```

真正的 dsh 字段转换在 Phase 2 实现，不能直接将 dsh 原始事件传给本 API。

## 输入契约

- Event 公共位置为 seq、turn（可 null）、可选 step。seq 必须严格递增、唯一，允许过滤后的间隙；turn/step 为非负整数。
- user：text、source（human/injected/unknown）。无法确证来源时不冒充 human。
- assistant：text、可选 requestUsage。text 是不包含工具调用重复表示的独立文本，usage 不是该文本的体积。
- tool_call：id、tool、args（有限深度的无环 JSON）、可选 argsText（原始参数串）。稳定比较使用 args；体积优先使用 argsText，并包含一次工具名。
- tool_result：callId、outcome（success/failure/unknown/interrupted/unresolved）、可选 text/tokens/failureKey/outcomeSource。
- boundary：reason（state-change/context-replacement/history-cut/interruption/unknown），适配器用于保留会改变过程解释的边界。
- 非 boundary 事件可带 tokens：只允许该事件内容的权威非负安全整数计数，不允许把整步 usage 填入。
- 未匹配结果和缺失结果保留数据质量提示；重复调用 id、重复结果 id、结果先于调用和非法位置直接拒绝，防止任意配对。适配器负责把原始数据问题呈现给用户。
- 模型未提交的 assistant/attempt 不属于本版本的 assistant 文本计数，适配器需用边界/诊断表达不完整性。附件 token 与继承历史语义不能通过纯文本 API 猜测。

`scope` 必须明确为 full-log 或 current-surface。调用方负责还原该范围；core 不从完整历史猜测当前上下文。`turns` 是输入里已知 turn 的不同值数量，不是完整 dsh UI 轮次统计投影。

## R1：连续失败过程

1. 按调用发生顺序配对结果，而不是按结果到达顺序判定。
2. 只使用 outcome=failure 且有非空 failureKey 或错误文本的尝试；错误标识必须与该段首个失败一致。
3. 要求同一工具，参数归一化后相同或相似度达到阈值。后一次调用必须发生在前一次结果之后，避免把并发调用误作重试。
4. 其他工具、成功/未知/中断/无结果、错误改变、真实或来源未知的用户消息，以及显式 boundary 都切断分段。助手叙述和普通 injected 消息不自动切段；会改变状态的注入需适配器另发 boundary。
5. 与段首参数比较，避免 A≈B、B≈C 但 A≉C 的渐变串联。

相似度使用 Unicode 字符二元组的多重集 Dice。不同数字序列不做近似合并。默认保留数字、时间戳和路径；volatileArgumentKeys 与 temporaryPathPrefixes 必须显式配置才启用。排序 JSON 对象键，不改变有语义的字符串空格。配置的临时根仅替换前缀，保留相对文件名。

这是对原提案激进去除数字/临时路径策略的保守修订：误合并不同任务的风险更高，因此宁可少报。字符近似不是语义同一，默认记录中置信度。错误由适配器判定，core 不对任意工具文本寻找 exit code 标记。

成功编辑通过“出现另一个工具调用”切断连续段，无需推断编辑是否有效。当前没有相关文件依赖图，也没有判断助手叙述中是否出现新诊断。该保守分段会漏掉夹杂读文件的循环，不能称为完整进展识别。

structured 失败来源且参数完全相同可标高置信度；归一化/近似、文本标记或未知来源为中置信度。高置信度指重复失败这一事实，不指“必然浪费”。

## R3：工具输出体积

使用每条 tool_result 的 tokens，缺失时按 text 的 Unicode code point 数 / 4 估算。严格大于阈值才标记；等于阈值不标记。topN 排名包含未超阈值的已知输出，数值相同按 seq 排序。未知体积不参与排名，保留整体体积不可用说明。孤立结果可以参与 R3，但不猜测工具身份。

有真实内容计数时发现置信度可为高；纯字符估算为中。大输出不能直接推断为无用，也不自动计入可避免体积。

## 统计与估算

- 事件文本体积与模型请求用量分开。调用参数只计一次，adapter 不可再次在 assistant.text 中包含同一 tool-call 表示。
- 重复部分严格为第 2 至 n 次的调用及结果；全局按调用 id 去重，R3 重叠不再相加。
- 计数来源为 reported/estimated/mixed/unavailable。没有文本又无 tokens 是未知；空字符串或 tokens=0 是已知零。
- 任一内容体积缺失时，会话总体体积与比例不可用，不用部分和冒充整体。比例的分母是本次分析内容体积，绝非账单或当前窗口占比。
- requestUsage 的输入、缓存读、缓存写、输出桶相加；reasoning 已包含于输出。提供 total 时不重复相加，矛盾总数、reasoning 超过 output 或非法数字会被拒绝。
- 所有 assistant 都有 usage 才显示完整请求总用量，否则显示不可用及覆盖数。这里仅覆盖已提交 assistant 消息，不证明包含失败 provider attempts 的实际消费。
- “疑似可避免”是启发式推断，不能保证真实节省、任务质量或性能提升。

## 当前配置

| 字段 | 默认 | 约束 |
|---|---|---|
| failLoopMin | 3 | 整数，至少 2 |
| similarityThreshold | 0.8 | 大于 0，不超过 1 |
| bigOutputTokens | 4000 | 非负有限数，严格超出才发现 |
| topN | 5 | 正整数 |
| volatileArgumentKeys | [] | 显式可忽略的参数键，递归应用 |
| temporaryPathPrefixes | [] | 显式临时根前缀，建议以分隔符结尾 |

`renderReport(report, {maxFindings: 3})` 默认展开前三项（按原始证据顺序），提示剩余数量，并展示输出排行。每项都保留轮次/seq 证据、计数口径、建议和限制。标题里的不可信字符串去除换行、控制字符与双向文本控制，限制长度；不直接打印原始错误输出或参数正文。结果是纯文本，不是可安全插入任意 HTML 的片段。

Phase 3 已加入 R2/R4 和 renderMarkdown；宿主命令支持 JSON、Markdown 与显式文件导出。core 仍只返回内存对象/字符串，不持久化配置。完整配置见 README。

## 后续实现补充

R2 使用适配器提供的 result.file（operation/path/range/fingerprint），仅成功读参与分组；成功 write/edit 及边界切段，跨编辑在途读取不分配给新版本。范围/内容缺失会降低置信度。R4 仅使用真实用户消息和上次人工输入后的工具活动，英文词边界，前 80 个 code point，低置信度且不计体积。

配置新增 rereadMin=3、correctionKeywords，未知键拒绝。Report 新增 audit（工具结局及保守验证命令观察）和 proposals（按建议文本去重、最多三条、保留全部来源 finding id）。summarizeReview 仅计算实际人工 agree/disagree，未评议/不确定不算认同，零样本标 no-findings。

适配器与导出层可以使用 Node，但独立的 tsconfig.core.json 继续以空 types、ES2024 lib 检查纯核心。详见 PHASE2-4.md 的真实验证限制。
