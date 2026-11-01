# dsh 会话契约：Phase 0

## 基线与证据优先级

调研日期：2026-11-01。实际安装 `@deepseek-ai/dsh@0.2.1-rc.5`，Cordis `4.0.5`；隔离 Node `24.22.2`（官方 ZIP，经官方 SHASUMS256 校验）、pnpm `9.15.0`。CLI `--version` 实测为 `0.2.1-rc.5`。兼容性仅确认该版本的只读探针，尚未验证 Waymark 插件加载。

字段以安装包 `lib/index.js` 和 `lib/types/**/*.d.ts` 为准，README 补充语义；线上 master 仅为辅助。包版本、文件摘要与运行结果见 [PHASE0.md](PHASE0.md)。调研依赖单独保存在 `.research/`，Node 在 `.tools/`，两者不提交。可复现锁文件在 `research/`。

官方文档入口：

- https://github.com/deepseek-ai/deepseek-harness
- https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish
- https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/session
- https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/interaction/commands

## 存储与只读读取

Home 优先级：显式配置、环境变量 `DSH_HOME`、默认 `~/.dsh`。基础 bundle 的持久化 root 是 `dshHomePath('sessions')`；自定义 root 允许变化。实际探针 root 由调用者显式传入，不猜测 profile 配置、不读取凭据。

JSONL 后端按项目/会话分目录：`<root>/<project>/<encoded-id>/session[.vN].jsonl.zstd`，也支持 compression `none` 的 `.jsonl`。有版本化世代及历史迁移，不能按普通 JSONL 文本直接读取。逻辑 Session format 为 4，不能从文件名简单推断逻辑版本。

Phase 0 使用官方 `@deepseek-ai/dsh-session-persistence-jsonl` provider，挂载到独立 Context，调用 `ctx.get('sessionPersistence').list()`、`open(id, 'read')`，再 `handle.read(0)`。读取结果是 `{ events, eventState }`；使用后关闭 handle 并 dispose 插件 fiber。无 writer、Agent、模型、服务器或遥测插件。未创建临时真实会话副本。

**发现的版本漂移**：线上 master 文档展示的 snapshot `location` 不存在于本次安装包的 `SessionPersistenceSnapshot`。安装版本提供 `header`、`revision`、可选 `formatStatus/eventCount/sizeBytes`。探针不依赖 `location`，通过读取前后全部规范日志的 SHA-256 汇总检查源内容未变。这个检查不是对外部并发写入的锁。

产品适配优先使用 `ctx.sessionQuery.readSession(id)`：它提供经过验证的完整日志快照，且不会使历史会话成为 live session。其 `listSessions()` 与当前/历史选择语义将在 Phase 2 实测；Phase 0 没有声称已验证查询服务或完整 web profile。

## 公共事件与消息

`SessionEvent = { type, seq, time, data, ... }`：seq 为会话内非负连续序号，time 为 epoch 毫秒。产生模型可见消息的事件携带 `surfaceOp`，可能替换早期内容；其他日志事件不携带。`sourceEventSeqs` 可引用来源。不要把完整原日志和当前模型可见 surface 当成同一事物。

| 原事件 type | data 真实字段 | 适配注意 |
|---|---|---|
| `turn/start`, `turn/end` | `turn`；end 另有 `reason` | 用真实边界归属轮次，不按用户消息数量自造 turn |
| `step/start`, `step/end` | `turn`, `step` | 一轮可含多步 |
| `user/message` | UserMessage：`id`, `role`, `content[]`, `source` | 没有直接的 turn 字段，按边界归属；`source.kind === 'user'` 才视为直接用户输入 |
| `assistant/message` | `turn`, `step`, `message`, `stream[]`, 可选 `usage`, `interrupted` | 只计一次内容；stream 是同一尝试的细节，不重复累加 |
| `assistant/attempt` | `turn`, `step`, `stream[]` | 没有提交 surface 消息的尝试，独立记录未知/尝试状态 |
| `tool/call` | `turn`, `step`, `callId`, `name`, `arguments` | arguments 是原始 JSON 字符串；保留解析失败状态 |
| `tool/result` | `turn`, `step`, `message`, 可选 `error`, `meta` | message 是 ToolResultMessage；meta 属于生产工具的私有形状 |

Message 公共字段为 `id`、`role`、`content`、`source`。content 是块数组，文本块为 `{type:'text', text}`，还有 reasoning/image/file/tool-call 等。不能直接 `String(content)`。用户角色也可能是 skill、指令或其他注入，R4 不能只看 role。

ToolResultMessage 另含 `toolCallId` 与可选 `isError`，`source` 为 `{kind:'tool', callId}`。工具调用也可能出现在 assistant 的 tool-call 内容块中；计数以独立 `tool/call` 为准，不能再重复产生调用。

## 失败与文件操作

- `message.isError === true` 是工具执行错误。`data.error`（name/code/可选 reason）只允许与 isError 一起出现，reason 不属于模型可见消息正文。
- 已安装 `dsh-tool-bash`、`dsh-tool-pwsh` 对普通非零退出在文本末尾追加 `[exit code: N]`，**不必设置 isError**；基础设施错误另行标记。不能把 isError 不为 true 等同于命令成功。
- 超时、停止、signal、后台运行和 promoted 结果需按对应状态处理，不能一概归为命令失败。pwsh 的 Windows 强杀可能仅显示 exit 1；若伴随中断事实应标为中断/未知。没有结果的 call 为 unresolved。
- 文本标记可能被普通输出仿造。优先检查已核验工具的结构化结果/meta；仅能依靠文本时，限定工具种类并降低证据强度。禁止给任意工具套用 shell 正则。
- 已核验 `dsh-tool-fs` 的 read/write/edit 参数包含 `file_path`，read 还有 `offset`、`limit`。成功编辑后重置相关重复读取段；失败编辑不重置。成功 write/edit 不保证内容实际改变，不能把它直接当作“有效进展”。其他编辑器和任意 shell 写入留给后续明确支持表。

## token 与估算

`assistant/message.data.usage?: TokenUsage`，字段为 `inputTokens`、`outputTokens`、可选 `totalTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens`。input 是未缓存输入，缓存桶单列；reasoning 属于输出，不重复累加。优先使用合法权威 total；缺失时按互斥桶计算并保留来源，不能与 total 同时相加。

工具结果没有统一的逐条精确 token 字段。内容体积以 Unicode 字符数 / 4 粗估并标注，中文与不同 tokenizer 可能有明显偏差；不会用整次 usage 替代一条输出大小。媒体体积不冒充文本 token。会话文本体积比例与跨多次请求的实际 token 用量分开。

建议 core 模型增加 seq、step、来源与估算方法；结果 outcome 为 success/failure/unknown/interrupted/unresolved。模型请求 usage 与事件内容体积分离。完整类型实现留到 Phase 1。

## 公开示例（独立合成）

以下保持已核验字段结构，身份和内容全部虚构；不是实际日志的拷贝，也不声称是完整可回放会话。

```json
{"type":"user/message","seq":1,"time":0,"surfaceOp":"append","data":{"id":"synthetic-u1","role":"user","source":{"kind":"user"},"content":[{"type":"text","text":"检查示例任务"}]}}
```

```json
[
  {"type":"tool/call","seq":2,"time":1,"data":{"turn":1,"step":1,"callId":"synthetic-c1","name":"bash","arguments":"{\"command\":\"example-check\"}"}},
  {"type":"tool/result","seq":3,"time":2,"surfaceOp":"append","data":{"turn":1,"step":1,"message":{"id":"synthetic-r1","role":"tool","source":{"kind":"tool","callId":"synthetic-c1"},"toolCallId":"synthetic-c1","content":[{"type":"text","text":"Example failure\n[exit code: 1]"}],"isError":false}}}
]
```

## 接入与卸载

包为 ESM，入口导出 name/inject/apply；bundle manifest 声明 `dsh.bundle.patch` 并把 patch 纳入打包文件，patch 以包名插入行。`dsh plugin --profile web add .` 用于 Phase 2；先验证 `--dump-config` 再重启并检查实际命令可用。共享 dsh 包作为与宿主兼容的 peer，开发时另列 devDependency；core 不 import 它们。

命令通过 `ctx.commands.register({name,description,input?,handler})` 注册；名字不带 `/`，handler 读取 invocation.agent/rawInput/signal，返回 `{kind:'success',text}` 或 `{kind:'error',text}`。注册效果随 fiber 卸载释放；同一 scope 重名报错。

原生 CommandResult 不进入模型上下文，但 `command/run` / `command/done` 会被 dsh 持久化并含结果文本。因此运行后并非磁盘零写入；Waymark 不重写被分析日志、不改 AGENTS.md/配置。显式导出才创建报告文件。当前探针未使用命令服务，确为只读。

## 未决项

见 [NOTES.md](../NOTES.md)。尤其：完整 web 安装/重载、更多 shell/编辑器、运行中状态与 live 优先的一致性未验证，不扩大兼容性声明。
