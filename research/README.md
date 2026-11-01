# 隔离调研环境

2026-11-02 更新：用户要求不得使用归档会话。以下 Phase 0 的旧探针/通用读取命令仅允许隔离研究根，不能直接传入用户真实会话根。真实采样使用 `scripts/prepare-unarchived-review.mjs <sessions-root> <workspace-metadata-file> <new-private-output>`，并先后运行范围检查；见 docs/UNARCHIVED-REVIEW.md。

本目录只提交研究依赖清单与 pnpm 锁文件。558 个安装包属于完整 dsh 调研环境，不是 Waymark core 的运行依赖。

使用 Node 24.9+、pnpm 9.15.0，在项目根目录执行：

```powershell
New-Item -ItemType Directory -Path .research -Force
Copy-Item research/package.json .research/package.json
Copy-Item research/pnpm-lock.yaml .research/pnpm-lock.yaml
pnpm --dir .research install --frozen-lockfile --ignore-scripts
node .research/node_modules/@deepseek-ai/dsh/lib/bin.js --version
node --test test/probe-session.test.mjs
node scripts/probe-session.mjs '<explicit-sessions-root>'
```

本次使用 Node 官方 ZIP v24.22.2 的隔离副本，避免替换系统 Node。安装忽略 lifecycle scripts；CLI 和所用只读持久化路径已通过，未验证全量 dsh 功能。上游 OTel peer 范围存在告警，见验收记录。

探针仅通过官方 `open(id, 'read')` 读取保存会话，不创建 writer，不注册网络服务。默认选创建时间最新的顶层会话，可额外传 session id。默认是整个传入 root，不承诺 workspace 过滤；正式命令语义另见计划。

输出只有版本与事件数量，不含消息、路径或会话 id。读取前后对 root 下规范日志进行内容摘要比较。真实数据或调试信息只能放 `.research/`，不得复制进本目录。失败时仅打印脱敏错误；需要本地排查时可设 `WAYMARK_PRIVATE_DIAGNOSTICS=1`，详情保存在 git 忽略的 `.research/probe-error.txt`。
