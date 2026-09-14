# handoff — evogen 项目交接

> 更新时间：2026-09-14。给下一个接手会话/协作者的完整上下文。读完这份文件，配合
> `README.md`（项目是什么）与 `docs/architecture.md`（边界与端口）即可继续工作。

## 项目一句话

让 AI 编码助手从自己的会话里学习：读会话日志 → 提炼证据 → 归并信号 → 生成建议 →
自检评分 → diff 预览 → 用户确认后以带标记块写入指令文件，且可精确撤销。
「内核 + 适配器」架构（`packages/kernel` 纯逻辑零依赖零 IO），客户端是 CLI
（`packages/cli`）与桌面控制台 Evogen Studio（`apps/desktop`，Tauri v2 + 薄 Rust 壳
+ Node SEA sidecar）。

## 里程碑状态（全部在线验收）

| 里程碑 | 状态 | 验收记录 |
| --- | --- | --- |
| M0 骨架 | ✅ 2026-09-13 | build 通过、status 列出可进化面与 331 会话、kernel dependencies 为空 |
| M1 只读闭环 | ✅ 2026-09-13 | 12 真实会话 → 3 条建议，证据可回溯 JSONL 原文，前后 sha-256 一致（零写入） |
| M2 写入闭环 | ✅ 2026-09-13 | 标记块写入、revert 摘要精确复原、漂移拒绝、部分失败可续做；一次真实误写被精确撤销 |
| M4 桌面控制台 | ✅ 2026-09-13 | tauri dev 跑通；一键发版真实发布 v0.0.2（版本 PR 自动化 + 双平台签名 + latest.json） |
| M3 适配器协议 | ⬜ 未开始 | 接口文档 + 最小示例适配器 |

当前线上版本 **v0.0.5**（含修复重发）。模型走通用的 chat-completions 兼容端点
（本机用 DeepSeek，`deepseek-flash`，约 0.1 元/次分析）。

## 架构速记

- 内核五阶段：`collect → distill（调模型）→ aggregate（确定性聚类）→ propose（只允许
  append + 硬去重 + 证据溯源强制）→ critique（自检，失败保守兜底）`。
- 端口：`SessionSource`/`SurfaceStore`（适配器实现）、`ModelClient`（cli 内置通用
  chat-completions 实现）、`ProposalStore`（内存版 + JSON 文件版 `~/.evogen/store.json`）、
  `Clock`/`IdFactory`（内核默认实现）。
- 写入协议：两段式（approve → apply），逐表达式 plan（纯 diff）→ apply（重读校验漂移），
  每笔留 `ChangeRecord`（前后摘要）；`revert <change-id>` 精确删标记块，记录保留标
  `[reverted]`。
- serve：127.0.0.1 随机端口 + token 鉴权，REST + SSE，stdout 单行握手
  `EVOGEN_READY port=… token=… pid=…`；Rust 壳解析握手后把 origin/token 经
  `api_origin`/`api_token` command 给前端。
- 模型配置三级回退：环境变量 `EVOGEN_MODEL_*` → cwd 的 `.env.local` → 用户级
  `~/.evogen/config.json`（Studio 设置页写入；GET /api/config 永不回传密钥）。

## 关键路径

| 内容 | 位置 |
| --- | --- |
| 五阶段实现 | `packages/kernel/src/pipeline/stages/`、工厂 `pipeline/factory.ts` |
| 应用/撤销编排 | `packages/cli/src/apply.ts` |
| 模型客户端与配置 | `packages/cli/src/config/model.ts`、`user-config.ts`、`env.ts` |
| serve（API 面） | `packages/cli/src/commands/serve.ts` |
| 桌面 UI | `apps/desktop/src/`（Dashboard 环路卡片、Settings、Proposals、History、About） |
| 更新横幅与共享状态 | `apps/desktop/src/update.ts`、`UpdateBanner.tsx` |
| SEA sidecar 构建 | `apps/desktop/tools/build-sidecar.mjs`（先 `pnpm -r build` 再 esbuild/SEA/postject） |
| 图标生成 | `apps/desktop/tools/make-icon.mjs`（零依赖 PNG/ICO，输出 src-tauri/icons/） |
| 安装器钩子 | `apps/desktop/src-tauri/installer-hooks.nsh`（清整个 `$INSTDIR` 子树） |
| 一键发版 | `.github/workflows/release.yml` + `.github/scripts/*.mjs`（27 例 node --test 回归） |
| 内核纯净性门禁 | `scripts/check-kernel.mjs`（dependencies 空 + 无 node: + 无适配器导入） |
| 发版操作手册 | `.github/RELEASING.md` |

## 实用命令

```bash
pnpm install && pnpm build          # 构建（CI 同款）
pnpm test                           # vitest，39 例
pnpm test:release                   # 发版编排回归，27 例
pnpm lint                           # biome ci
pnpm check:kernel                   # 内核纯净性
node packages/cli/dist/index.js status        # 只读概览
node packages/cli/dist/index.js proposals --save --limit 12   # 分析并保存建议
node packages/cli/dist/index.js approve|apply <id> [--project dir] [--store path]
node packages/cli/dist/index.js changes; node packages/cli/dist/index.js revert <change-id>
pnpm --filter @evogen/desktop tauri dev         # 桌面开发（EVOGEN_SIDECAR_CMD 指定 sidecar）
gh workflow run release.yml -f bump=patch       # 一键发版（none=重试当前版本）
```

## 实战踩坑（都已修复并写进 tauri-app-infra skill）

1. **dotenv 行内注释污染值**：`.env.local` 里 `URL=… # 注释` 曾把注释当 URL 一部分，
   模型调用全 404 且被吞。解析器已支持行内注释；distill 全失败改为大声报错。
2. **latest.json 下载 URL 空格**：GitHub 资产名会把空格规范化为点（`Evogen.Studio_…`），
   URL 用 `%20` 会出现「检查更新成功、下载 404」。脚本已改为空格→点。
3. **覆盖安装 `Error opening file for writing`**：sidecar 落盘在 `binaries\` 而非
   `resources\`，安装器钩子扫错子树杀不到残留进程。已改为清整个 `$INSTDIR` 子树
   （保留 CIM 跨位数查询、排除 uninstall.exe 两个坑）。
4. **签名私钥 Secret 必须是纯 base64 行**（`.key` 第二行）：整文件带注释头解码报
   `Invalid symbol 58`。已用 `tauri signer sign` env 方式实测验证。
5. **仓库设置「允许 Actions 创建/审批 PR」默认关**：版本 PR 创建 403。用
   `gh api --method PUT repos/coconilu/evogen/actions/permissions/workflow
   -f can_approve_pull_request_reviews=true` 开启（只支持 PUT，PATCH 404）。
6. **CI 全新克隆没有 workspace dist**：build-sidecar 先 `pnpm -r build`。
7. **macOS updater 产物需要 `app` target**：只有 dmg 会警告
   "no updater-enabled targets" 且 `.app.tar.gz` 缺失。targets 为 `["nsis","dmg","app"]`。
8. **`git push | tail` 管道吞退出码**：会误触发不带新代码的发版。push 用
   `set -o pipefail` 并 if 判断；取消误发版用 `gh run cancel`，版本 PR/分支要清理。
9. **tsbuildinfo 缓存**：删 dist 后 `tsc -b` 认为无需重编。冷构建验证时先删
   `packages/*/*.tsbuildinfo`。
10. **本机到 github.com 的 git 连接极不稳**（api.github.com 相对可靠）：push 失败重试；
    单文件紧急改动可用 contents API 过渡提交，之后 `git pull --rebase` 对齐。

## 密钥与凭据

- minisign：`~/.tauri/evogen-studio/`（`evogen-studio.key` + `password.txt`）。
  **Secrets 只写不读，这里是唯一可读副本——用户需存入密码管理器**。公钥已写死
  `tauri.conf.json`。丢失 = 重新生成密钥对，老用户手动重装一次。
- Secrets：`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  （coconilu/evogen，已配置并以真实发版验证）。
- 模型 API key：用户级环境变量 `EVOGEN_MODEL_*`（BASE_URL/ID 有行内注释污染已清洗；
  仓库内 `.env.local` 同步存在，已 gitignore）。
- gh 登录账号 coconilu（admin）；远端 `https://github.com/coconilu/evogen`，默认分支 main。

## 用户侧待办 / 验收

- [ ] 用户正在从 v0.0.2 升级：方式 A 走应用内「关于→检查更新→v0.0.5→立即更新」
      （顺便完成自动更新端到端验收），或方式 B 从 Releases 手动装。残留 sidecar 已杀、
      目录已解锁。
- [ ] 装完确认：不再弹 Error opening file for writing；仪表盘有「进化环路」卡片；
      「设置」页可见模型配置并可「测试连接」。
- [ ] 提醒用户把 minisign 私钥与密码存入密码管理器。

## 下一步（按优先级）

1. **M3 适配器协议**：适配器接口文档 + 最小示例适配器；验收 = 新增一个包即可接入新宿主，
   内核与 CLI 零改动（roadmap 原文）。
2. **体验反馈迭代**：设置页/环路卡片/建议评审刚上，等用户实际使用反馈。
3. 可选：Intel Mac 构建腿（darwin-x64）、Apple 签名/公证（当前未做，macOS 首装需手动放行）、
   sidecar 挂 Job Object 根治残留锁文件（installer-hooks 的彻底版）。
4. skill 维护：tauri-app-infra 已沉淀 10 条实战坑（URL 规范化、钩子路径跟布局、
   push 管道、Secret 纯 base64 等），新坑继续补进去。

## 工程约定（不要回退）

- AGENTS.md 三条硬规则：内核零依赖零 IO、仓库内不出现模型厂商名（宿主名 Codex 等可用）、
  宿主文件写入必须可撤销。CI 门禁：lint + build + check:kernel + test(39) + test:release(27) + smoke。
- 提交信息中文，写清「改了什么 / 怎么验证的」。
- Node 24（engines `>=24`）、pnpm 10.24（packageManager 锁定）、Tauri v2、React 19、
  Biome（2 空格、单引号、src-tauri 整体排除）。
- 版本双文件同步：`apps/desktop/package.json` + `apps/desktop/src-tauri/tauri.conf.json`
  （bump 脚本自动处理，2 空格缩进）。
