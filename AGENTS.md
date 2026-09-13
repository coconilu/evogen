# AGENTS.md — evogen

这个仓库是「内核 + 适配器」的 monorepo。改动前请先读 `README.md` 与 `docs/architecture.md`。

## 硬性规则

1. **内核纯净**：`packages/kernel` 不得 import 任何适配器，不得 import `node:fs` / `node:path` / `node:child_process`，`dependencies` 必须保持为空。IO 一律通过 `ports` 注入。
2. **供应商中立**：不得在代码、注释、文档、提交信息、Issue/PR 中出现任何商业产品的名称，也不得粘贴第三方专有实现或专有文档片段。需要指代时使用通用描述。
3. **写文件必须可撤销**：任何对宿主文件的写入都要包裹在带标记的块中，并留下可核对的变更记录。默认是先预览、后确认。

## 验收习惯

- 每个里程碑的验收标准写在 `docs/roadmap.md`，完成前先跑通对应命令。
- 提交信息用中文或英文都可，但要说清「改了什么、怎么验证的」。
