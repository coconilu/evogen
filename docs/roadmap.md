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

## M2 写入闭环

交付：

- 两段式：`evogen approve <proposal>` 后才允许 `evogen apply <proposal>`
- 变更记录（含写入前后摘要）与 `evogen revert <change-id>`
- 部分失败时不提交整体状态，逐条可续做

验收：

- 写入只落在标记块内；`revert` 后文件摘要回到写入前
- 手工篡改文件后再次运行，能检测到漂移并拒绝覆盖

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
