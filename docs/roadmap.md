# Roadmap

原则：每个里程碑都以**可以跑出来的验收标准**结束，不写「基本完成」。

## M0 骨架（已完成，2026-09-13）

验收记录：`pnpm build` 三包通过；`evogen status` 列出可进化面（项目级与用户级指令文件）与 331 个可读会话；`packages/kernel/package.json` 的 `dependencies` 为空。

交付：

- monorepo 与三包结构：`kernel` / `adapter-codex` / `cli`
- 内核的领域模型与端口，零依赖、零 IO
- Codex 适配器：会话日志读取、可进化面枚举、摘要、带标记写入与撤销
- 只读命令 `evogen status`

验收：

```bash
pnpm install && pnpm build
node packages/cli/dist/index.js status
```

- 构建通过，`status` 能列出本机可进化面与可读会话数
- `packages/kernel/package.json` 的 `dependencies` 为空（CI 里已有断言）

## M1 只读闭环（已完成，2026-09-13）

验收记录：对 12 个真实会话运行 `evogen proposals`，产出 3 条建议（每条含来源会话、证据引用、理由、风险、置信度；证据 quote 可回溯到会话文件）；运行前后所有可进化面 sha-256 摘要完全一致（零写入）。模型经通用的 chat-completions 兼容端点接入（EVOGEN_MODEL_* 配置）。

交付：

- `collect → distill → aggregate → propose → critique` 流水线可运行
- `evogen proposals` 输出建议列表与 diff 预览，**不写任何文件**
- 每条建议携带：来源会话、证据引用、理由、风险、置信度

验收：

- 对 ≥10 个真实会话运行，产出 ≥3 条建议，且每条都能点回原始会话片段
- 运行前后对所有可进化面做摘要比对，必须完全一致

## M2 写入闭环（已完成，2026-09-13）

验收记录：CLI 端到端——`approve` → `apply` 后文件仅新增一个带标记的块（写入前后 sha-256：
2d44df09 → 1702ad16），`revert` 后摘要精确回到写入前（2d44df09）；手工篡改 plan→apply
窗口内文件内容时 apply 拒绝覆盖并保持可重试（自动化测试覆盖）；部分失败时已写入部分保留、
失败项逐条报告（partially_applied）。另有一次真实场景验证：apply 到 `agents.user` 的
变更通过 `changes` / `revert` 精确恢复原摘要（e5d5b573），未损伤文件其它内容。

## M4 桌面控制台（已完成，2026-09-13）

交付：

- `apps/desktop`：Tauri v2 薄 Rust 壳 + React 前端，sidecar 方式复用 `evogen serve`
  （127.0.0.1 随机端口 + token 鉴权，stdout 单行握手）
- 四个页面：仪表盘（可进化面/会话概况/发起只读进化）、建议（列表/详情/diff/批准/应用）、
  变更历史（逐笔撤销）、关于（版本与更新入口）
- 发布基建：SEA 独立 sidecar 二进制、NSIS 安装器钩子、updater 插件接线、CI 双 job 门禁、
  一键发版（版本自动 PR + 自动审批 + 固定 SHA 双平台签名构建 + latest.json）

验收记录：

- `tauri dev` 跑通：Rust 壳拉起 sidecar 并解析握手行，前端经 token 访问本地 API
- `tauri build` 产出含 sidecar 的 NSIS 安装包
- 真实发版 v0.0.2 在线完成：版本 PR 自动创建/审批/合并（#4），双平台签名构建成功
  （Windows NSIS + macOS DMG/app.tar.gz），latest.json 携带双平台签名发布，
  tag/构建/发布固定同一提交（6d45cfa）；编排回归测试 27 例随 CI 门禁运行
- 首次发版过程中修复的实战问题：Actions 无创建 PR 权限（仓库设置 API 开启）、
  CI 缺 dist 构建（build-sidecar 先 pnpm -r build）、macOS updater 产物需 app target、
  私钥 Secret 需为纯 base64 行（整文件含注释头无法解码）

## M3 适配器协议

交付：

- 适配器接口文档 + 一个最小示例适配器
- 宿主能力自述（支持哪些操作、哪些可进化面）

验收：

- 接入一个新宿主只需新增一个包，内核与 CLI 无需改动
- 示例适配器能把 `status` 与 `proposals` 跑通

## 非目标

- 云端服务、账号体系、跨设备同步
- 上传会话内容
- 自动改文件（默认永远关闭）
