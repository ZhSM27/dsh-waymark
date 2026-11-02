# Codex 内置浏览器验收

日期：2026-11-02。使用 computer-use 浏览器控制，在 Codex IAB 中操作 dsh Web，使用本机已有 DeepSeek API key 完成真实模型往返。版本为隔离安装的 dsh 0.2.1-rc.5，界面选择 DeepSeek-V4.1-Flash。

## 范围与数据

服务器使用独立 DSH_HOME，未挂载用户原会话目录。本轮只读取本地凭据文件中的指定 DeepSeek 引用；凭据通过进程环境传递，没有输出密钥、复制凭据库或写入项目配置。模型请求使用宿主官方 DeepSeek endpoint。

测试数据均为本轮新建的合成会话。只提供两个无副作用工具：waymark_probe 返回固定失败，waymark_large 返回固定大文本；隔离 profile 的工具 guard 拒绝其他工具。没有读取用户已有会话（包括已归档对话）或项目文件。测试辅助模块、日志、截图及统计保留在忽略目录 `.research/`，不打包发布。

## 实际检查

| 场景 | 结果与证据 |
|---|---|
| 模型连接 | 界面完成真实模型回复；没有仅凭模型列表判断请求可用 |
| 原生命令 | guard status/mode/delivery/feedback 和 retro 均在会话中返回可展开结果 |
| R1 提醒 | 顺序执行两次固定失败后，模型收到并复述 R1 消息，引用 seq 65、71；持久化的 Waymark 来源消息为 seq 74 |
| R3 提醒 | 单次大输出后，模型收到并复述 R3 消息，引用 seq 87；持久化的 Waymark 来源消息为 seq 90 |
| 仅用户可见 | 最终修复后新一轮大输出的本地状态为 observed.R3=1、sent=0、pendingNotices=1，证据 seq 129；回合结束后仍可查看，未新增 Waymark 模型消息 |
| 反馈 | 用 uncertain 作为接口测试值，结果可见；这不是用户认可或规则效果统计 |
| 离线复盘 | 浏览器中返回 6 轮合成记录的报告：7 次工具调用，4 次失败、3 次成功，3 项 R3；默认离线 R1 阈值为 3，因此两次一段的失败不形成离线发现 |

隔离日志检查确认总共只有 7 次合成工具调用、两条 Waymark 模型可见消息；末次仅用户可见调用之后没有新 Waymark 消息。模型可见消息真实持久化来源为 waymark，不仅依据模型的自述判断成功。

初次 R1 失败及初次本地队列丢失也保留在合成测试记录中，不隐藏失败轮次。成功重测对应修复后的运行。

## 本轮发现并修复的问题

1. **日志投递确认误切分。** 已安装 dsh-session-log-deepseek 的 delivery-accepted 仅记录 sessionId/sessionFormatVersion/throughSeq 水位，旧逻辑把它当作未知状态变化，清掉失败链。现在对这个已核验事件及标题元数据保持连续性；其他未知必需事件仍保守切段。离线适配器同步采用相同口径。
2. **结束原因结构错误。** 已安装 dsh-session 的 TurnEndReason 是带 kind 的联合对象，正常结束为 `{kind:'completed'}`；旧字符串比较会把正常结束当中断，清除本地队列。已改为读取 reason.kind，正常完成保留提醒，aborted 等原因仍清理。

依据为本机隔离安装包的 dsh-session/lib/types/types.d.ts（TurnEndReasonMap）与 dsh-session-log-deepseek/lib/index.js（acceptance watermark 生产与折叠）。新增合成回归覆盖上述两点及未知事件仍切段的反例。

最终 78 项单元测试、两套类型检查、构建、ESM 烟测及真实 Cordis/ToolRuntime 合成集成验证通过。上述模型测试说明消息链路可用，不证明实际任务质量提升、普遍准确率或 token 节省。暂停、拦截、其他宿主版本、所有生命周期路径和原中断分类疑点仍不在已通过结论内。
