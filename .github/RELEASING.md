# 发版指南

一键发版：GitHub → Actions → **Release** → Run workflow → 选择版本增量 → 运行一次。
后续（版本 PR、CI、合并、双平台签名构建、Release 与 latest.json）全部自动完成。

| 输入 | 行为（以当前 1.2.3 为例） |
| --- | --- |
| `patch`（默认） | 自动升级并发布 1.2.4 |
| `minor` | 自动升级并发布 1.3.0 |
| `major` | 自动升级并发布 2.0.0 |
| `none` | 不加版本号，重试当前版本的发布 |

## 前提（已配置一次，无需重复）

- Secrets：`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  （minisign 签名私钥，用于 updater 更新包签名；公钥已写死在
  `apps/desktop/src-tauri/tauri.conf.json`）。
- CI workflow 可被 `workflow_dispatch` 触发（已在 ci.yml 开启）。

## 重试与例外

- 构建/上传失败：Re-run failed jobs。
- 版本已合并但发布未完成：用 `none` 重试；不会覆盖已正式发布的同版本。
- `none` 不会触发版本 PR（prepare job 跳过），直接校验当前默认分支 HEAD。

## 密钥须知

GitHub Secrets 只写不读：本机 `~/.tauri/evogen-studio/evogen-studio.key`
是私钥唯一可读副本，请存入密码管理器后谨慎保管。若私钥与 Secrets 同时丢失，
只能重新生成密钥对并更新 tauri.conf.json 的公钥，老用户需手动重装一次。

## 已知边界

- macOS 产物为 Apple Silicon（darwin-aarch64），未做 Apple 签名/公证，
  首次安装需在系统设置中手动放行；Intel Mac 需另加 x64 leg。
- 自动更新的体验按 docs/roadmap.md M4 的验收标准执行。
