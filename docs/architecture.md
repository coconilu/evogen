# 架构

## 一句话

内核描述「进化这件事怎么做」，适配器描述「在某个宿主里具体怎么做」，两者之间只有端口。

## 数据流

```text
SessionSource ──list/read──▶ 会话（RawSession）
      │
      └─▶ [collect] ─▶ [distill] ─▶ 证据 Evidence
                              │
                              └─▶ [aggregate] ─▶ 信号 Signal
                                        │
                                        └─▶ [propose] ─▶ 建议 Proposal（含多个 Expression）
                                                  │
                                                  └─▶ [critique] ─▶ 风险与置信度
                                                            │
                                                            ▼
                                              SurfaceStore.plan ─▶ diff 预览 ─▶ 你确认
                                                                        │
                                                                        ▼
                                                            SurfaceStore.apply ─▶ ChangeRecord
```

## 五个阶段

| 阶段 | 输入 → 输出 | 说明 |
| --- | --- | --- |
| `collect` | 无 → `RawSession[]` | 从宿主读取会话，做体积裁剪 |
| `distill` | 会话 → `Evidence[]` | 只留下「值得沉淀」的片段：被纠正、重复出现、任务失败、明确偏好、有效做法 |
| `aggregate` | 证据 → `Signal[]` | 把零散证据归并成稳定信号，去重降噪 |
| `propose` | 信号 → `Proposal` | 生成具体改动（改哪个文件、写什么、为什么） |
| `critique` | 建议 → 建议 | 自检：风险、置信度、是否越权 |

写盘不在流水线里。流水线只产出 `Proposal`，落盘由 `SurfaceStore` 执行，且必须经过确认。

## 写入闭环（M2）

两段式：建议以 `draft` 状态保存，`approve` 后才允许 `apply`。apply 时逐个表达式
`plan`（纯函数算 diff）→ `apply`（重读文件校验漂移后写入），每一笔都产生
`ChangeRecord`（前后摘要）；单条失败不回滚其余条目（`partially_applied`），可重试。
`revert <change-id>` 只删除该 change 的标记块，变更记录保留并标记 `[reverted]`。

## 客户端形态：CLI 与桌面控制台

内核与适配器被两个前端复用，业务逻辑只有一份：

| 客户端 | 形态 | 与内核的关系 |
| --- | --- | --- |
| `packages/cli` | 命令行：`status` / `proposals` / `approve` / `apply` / `revert` / `changes` | 直接组装 `PipelineContext` |
| `apps/desktop` | Tauri v2 桌面应用（Evogen Studio） | 经 `evogen serve` 的本地 API 访问 |

`evogen serve` 只绑定 `127.0.0.1` 随机端口，token 鉴权，REST + SSE（阶段进度实时推送），
stdout 输出单行握手 `EVOGEN_READY port=… token=… pid=…`。桌面壳（薄 Rust 层）负责拉起
sidecar（发布形态是 Node SEA 编译的独立二进制，开发形态由 `EVOGEN_SIDECAR_CMD` 指定）、
解析握手、退出时清理进程树；前端只做展示与确认交互。

## 端口（内核只认这些）

| 端口 | 谁实现 | 内核不知道的事 |
| --- | --- | --- |
| `SessionSource` | 适配器 | 会话日志在哪、什么格式 |
| `SurfaceStore` | 适配器 | 指令文件叫什么、怎么写入、怎么撤销 |
| `ModelClient` | 调用方注入（cli 内置通用 chat-completions 实现） | 用哪个端点、怎么鉴权 |
| `ProposalStore` | 内核的内存实现；cli 的 JSON 文件实现 | 建议和变更记录存在哪 |
| `Clock` / `IdFactory` | 内核的通用实现 | 便于测试时替换 |

## 为什么这样切

1. **可测试**：内核可以在没有文件系统、没有网络的条件下跑完整流水线。
2. **可移植**：接入新宿主 = 新写一个适配器，内核零改动（M3 的验收标准）。
3. **可解释**：每次进化都留下 `PipelineRun` 与 `ChangeRecord`，能回答「这条规则是哪次会话让我加的」。

## 写入约定

追加型改动写入一个带标记的块：

```markdown
<!-- evogen:change:<changeId> -->
...内容...
<!-- /evogen:change:<changeId> -->
```

撤销 = 精确删除这一块，因此任何一次写入都能在不动其它内容的前提下回退。替换型改动不包裹标记块，因此**默认不生成替换型建议**；确需替换时必须在预览里显式标注，并由使用者确认。
