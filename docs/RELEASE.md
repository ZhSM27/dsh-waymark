# 0.2.0-alpha.1 发布清单

用户已明确授权公开 GitHub 源码仓库及 npm 包。本次以 Alpha 收集反馈，npm 使用 alpha dist-tag，不承诺稳定兼容性。下列历史清单已补记当前状态；未勾选的远端步骤仍需实际执行。

## 已准备

- [x] R1–R4、统一证据、输出与重复体积、工具/验证观察、候选规则。
- [x] JSON、Markdown 和显式导出，无自动 AGENTS/config 修改。
- [x] TypeScript 严格检查、零 dsh 核心依赖、合成单元测试与构建产物检查。
- [x] dsh 0.2.1-rc.5 隔离 profile 本地安装、配置组合、原生命令与 Web 启动验证。
- [x] 真实十会话批量分析；八条发现与十四条对照片段保留本地。
- [x] 2026-11-02 用户确认八项 R3 全部认同，逐项记录并统计为 8/8（100%）。本批无需进行低于 50% 的阈值收紧重测。
- [x] README、合成示例、兼容性边界、隐私说明、MIT、0.2.0-alpha.1、keywords。
- [x] 78 项合成测试、原生流水线及真实模型浏览器验收。
- [x] 已知限制、更新记录、Issue 模板及 Windows/Linux CI 配置。

## 仍需完成

- [x] 按新增归档限制重建并让子代理复核十二个合格对照片段；原十四个不整体复用。
- [x] 补充三十二个 R1/R2/R4 真实候选并完成代理判断，重复窗口单列。
- [ ] 跟进中断分类疑点、低置信度 R4 边界线索和仍缺乏确证正例的规则；代理结论不替代用户认同率。
- [x] 将归档保护接入生产命令；默认排除归档或未登记会话。
- [x] 从已登录浏览器确认 GitHub 账号 ZhSM27；仓库拟为 dsh-waymark。
- [x] 发布前重查 npm 名称 dsh-waymark，查询返回未占用；不代表名称保留。
- [x] 复查最终 tgz 内容和兼容声明；公开 GitHub 安装包下载后哈希匹配，干净 consumer 安装和导入通过。
- [x] 用户明确批准 GitHub 和 npm 公开发布。
- [x] 移除 private:true，补充 repository/bugs/homepage，配置 public/alpha。
- [x] 扫描全部可达 Git 历史及最终包：16 个提交、138 个 blob 的常见凭据/私人目录模式检查无发现，未跟踪研究数据。此为模式检查，不宣称全面安全审计。
- [x] 从干净检出使用冻结锁文件安装、测试并构建。
- [x] GitHub 首次远端 CI 的 Windows/Linux 均通过（run 41418008650）。
- [x] 创建公开仓库 ZhSM27/dsh-waymark，推送 main，设置 dsh-plugin 等 topics。
- [x] 发布 v0.2.0-alpha.1 GitHub prerelease，上传审核过的 tgz。
- [ ] npm publish：登录账号 zhsm27，首次请求被官方 403 拒绝，要求先启用 2FA；尚未发布成功。

GitHub 安装包 SHA-256：`73b9270a4b8645da870510f15722e8f2c321918feb271dac61e0d789b8424cb5`。npm 待发布的包与该公开资产是同一文件。

当前不宣称实际 token 节省、模型质量提升或普遍诊断准确率。Alpha 提供 R1/R3 observe/warn；自动拦截、暂停/恢复、awesome 列表 PR 和其他 harness 适配仍不在本次范围。
