# evogen 使用文档

> 面向使用者的完整操作手册：命令行工具（CLI）与桌面控制台（Evogen Studio）。
>
> 架构与设计背景见 [architecture.md](architecture.md)，里程碑与验收标准见 [roadmap.md](roadmap.md)。

evogen 让 AI 编码助手从自己的会话日志里学习：读取会话、提炼证据与信号、生成对指令文件的修改建议（diff 预览），**在你明确确认之后**才写入指令文件，并且每笔写入都可以精确撤销。全部逻辑在本机运行，不上传会话内容。

第一版支持 Codex 宿主（README 中的 adapter-codex），包括三类「可进化面」：

| 可进化面 id | 类型 | 位置 |
| --- | --- | --- |
| `agents.project` | instructions | 项目根目录的 `AGENTS.md` |
| `agents.user` | instructions | 宿主状态目录（默认 `~/.codex`）下的 `AGENTS.md`，可用 `CODEX_HOME` 环境变量覆盖 |
| `skill.<名称>` | skill | 项目下 `.agents/skills/<名称>/SKILL.md` |

---

## 目录

- [安装与启动](#安装与启动)
- [五分钟上手](#五分钟上手)
- [三段式安全模型](#三段式安全模型)
- [CLI 命令参考](#cli-命令参考)
- [模型配置（三级回退）](#模型配置三级回退)
- [Evogen Studio 桌面端](#evogen-studio-桌面端)
- [本地 API 服务（serve）](#本地-api-服务serve)
- [常见问题与排错](#常见问题与排错)

---

## 安装与启动

需要 Node.js 24+ 与 pnpm 10+。

```bash
pnpm install
pnpm build
```

CLI 的可执行入口是 `packages/cli/dist/index.js`，包名为 `evogen`：

```bash
node packages/cli/dist/index.js status
# 或全局链接后直接使用
evogen status
```

桌面端 Evogen Studio 以安装包形式分发（v0.0.5 起支持在线自动更新），见仓库 Releases 页面。安装后启动即是本地控制台，无需额外配置即可进入只读仪表盘。

---

## 五分钟上手

```bash
# 1. 看看本机有哪些可进化面、能读到多少会话（只读，不联网）
evogen status

# 2. 配置模型端点（三选一，见下文「模型配置」）
#    - Studio 设置页填写并保存
#    - 环境变量 EVOGEN_MODEL_*
#    - 工作目录下的 .env.local

# 3. 跑一次只读分析，查看建议与 diff 预览
evogen proposals --save

# 4. 两段式写入：先批准，再应用
evogen approve <proposal-id>
evogen apply <proposal-id>

# 5. 不满意？精确撤销
evogen changes
evogen revert <change-id>
```

---

## 三段式安全模型

evogen 对宿主文件的每一次写入都遵循同一套安全模型，理解它就能放心使用所有命令。

### 第一段：proposals 只读分析

`evogen proposals`（以及 Studio 仪表盘的「运行进化」）执行完整的进化流水线——收集会话 → 提炼证据 → 归并信号 → 生成建议 → 自检评分——但**全程不写任何文件、除了模型端点之外不访问任何网络**。

运行结束后会输出完整性核对：流水线在前后分别计算所有可进化面的摘要（digest），如果不一致会明确标出 `CHANGED ✗`（正常运行时永远是 `unchanged ✓`）。这是你可以自己验证的承诺，不必信任输出文字。

### 第二段：approve / apply 两段式写入

写入被拆成两步，缺一不可：

1. **approve**：只把建议的状态从 `draft` 改为 `approved`，不碰任何文件。
2. **apply**：只接受 `approved` 状态的建议，逐条执行表达式写入。

apply 的每一条写入都有三重保障：

- **带标记的块**：默认操作是追加（append），写入内容包裹在成对的标记之间，一眼可辨、可精确定位：

  ```markdown
  <!-- evogen:change:chg_xxxxxxxx -->
  （写入的指令内容）
  <!-- /evogen:change:chg_xxxxxxxx -->
  ```

- **漂移拒绝**：apply 在真正写盘前会重新读取目标文件，与生成 diff 时的快照比对。如果文件在此期间被改过（无论手动还是其他工具），该条写入直接失败并提示重新生成建议，**绝不会基于过期的预览盲目写入**。
- **部分失败可续做**：每条表达式独立规划、独立执行，一条失败不会回滚其他已成功的条目。建议状态会相应变为 `applied`（全部成功）或 `partially_applied`（部分成功），失败的条目带原因输出，修复后可以重新处理。

每笔成功的写入都会记录一条变更记录（changeId、目标路径、写入前后的摘要、时间），存放在本地变更存储里。

### 第三段：revert 精确撤销

`evogen revert <change-id>` 按变更记录找到文件中对应的标记块，**只删除这一对标记之间的内容**，文件其余部分原样保留。撤销后变更记录保留在案并标记 `[reverted]`，可追溯。

注意：默认的 append 操作天然支持精确撤销；如果某条写入用了 `replace` 操作（替换已有文本），它没有包裹在标记块里，系统会拒绝自动撤销并提示你按当初评审过的 diff 手工还原。

### 各命令的验证方式

| 命令 | 如何验证它没有越权 |
| --- | --- |
| `status` | 输出末尾明示「nothing was written, nothing was sent anywhere」；用 `git status` 之类工具可确认无文件变化 |
| `proposals` | 输出末尾的 `integrity surfaces unchanged ✓` 行；配合 `git status` 双重确认 |
| `approve` / `reject` | 只改建议状态；文件系统无变化 |
| `apply` | 输出每笔写入的路径与前后摘要（digest）；打开目标文件只能看到成对的标记块；`evogen changes` 里有对应记录 |
| `revert` | 撤销后再次 `evogen changes` 显示 `[reverted]`；用前后摘要可核对文件确实还原 |
| `serve` | 只绑定 `127.0.0.1`，且所有请求需要握手令牌认证（见下文） |

---

## CLI 命令参考

以下命令与参数均以 `packages/cli/src` 的实际实现为准。全局可用参数先列一次，各命令条目只写差异。

| 参数 | 作用 | 适用命令 |
| --- | --- | --- |
| `--json` | 机器可读的 JSON 输出 | status、proposals |
| `--all` | 列出全部 skill 面（默认只显示前 5 个） | status |
| `--project <dir>` | 项目根目录（默认当前目录），只影响项目级可进化面 | status、proposals、serve、approve、reject、apply、revert |
| `--sessions <dir>` | 会话日志目录（默认宿主自己的存储） | status、proposals、serve、approve、reject、apply、revert |
| `--limit <n>` | 取最新的 n 个会话参与分析（默认 20，上限 200） | proposals |
| `--save` | 把本次建议持久化到本地存储 | proposals |
| `--store <path>` | 指定存储文件位置（默认 `~/.evogen/store.json`） | approve、reject、apply、changes、revert |
| `--port <n>` | serve 的 TCP 端口（默认由系统分配空闲端口） | serve |

### evogen status

只读。列出本机可进化面（存在性、大小、摘要）与可读会话数量，不联网、不写盘。

```bash
evogen status [--json] [--all] [--project <dir>] [--sessions <dir>]
```

文本输出示例（示意，digest 已截短）：

```text
evogen status

host            codex
project root    /home/you/my-project
sessions root   /home/you/.codex/sessions

surfaces
  ✓ agents.project         instructions  2.1 KB   3f2a9c…  /home/you/my-project/AGENTS.md
  ✓ agents.user            instructions  1.4 KB   8b71de…  /home/you/.codex/AGENTS.md
  ✗ skill.review           skill         missing  -        /home/you/my-project/.agents/skills/review/SKILL.md
    … 2 more skill surfaces (use --all to list them)

sessions
  files            12
  newest           2026-09-14T03:12:45.000Z
  newest turns     45

read-only command: nothing was written, nothing was sent anywhere.
next: `evogen proposals` runs the read-only analysis; see docs/roadmap.md.
```

### evogen proposals

只读。执行完整进化流水线（会话 → 证据 → 信号 → 建议 → 自检），打印信号清单、建议的表达式与 diff 预览、证据出处、风险/置信评分与模型用量。需要已配置模型端点（未配置时以退出码 2 失败并打印配置指引）。

```bash
evogen proposals [--json] [--save] [--limit <n>] [--project <dir>] [--sessions <dir>]
```

- 不加 `--save`：结果只存在内存里，退出即消失，后续无法 approve/apply。
- 加 `--save`：建议写入本地存储 `~/.evogen/store.json`，供 approve/apply 使用。

文本输出要点（示意）：

```text
evogen proposals

run           run_01J9…
sessions        20
project root  /home/you/my-project

stages
  collect      20 items     12 ms
  distill      31 items   8940 ms
  aggregate     6 items     15 ms
  propose       2 items   6210 ms
  critique      2 items   4100 ms

signals (6)
  [correction] ×3 session(s)  测试前先跑类型检查，避免把编译错误带进提交
      evidence: 5 item(s)

proposal  prop_01J9…
title     把「提交前先类型检查」沉淀进项目指令
critique  risk 0.21 · confidence 0.78
          建议为纯追加，作用面明确，风险低。

  [expr_01J9…] agents.project · append
  path      /home/you/my-project/AGENTS.md
  why       多个会话出现同一纠正……
  content:
    ## 提交纪律
    - 提交前先运行类型检查
  diff:
    + ## 提交纪律
    + - 提交前先运行类型检查
  evidence:
    [correction] session <id> (confidence 0.90)
      “先跑一遍类型检查再提交”
      用户明确纠正……

integrity  surfaces unchanged ✓ (nothing was written)
usage      3 call(s) · in 12500 · out 980 tokens
saved      /home/you/.evogen/store.json
```

### evogen approve / reject

把存储中的建议从 `draft` 标记为 `approved` 或 `rejected`。只改状态，不写宿主文件。

```bash
evogen approve <proposal-id> [--store <path>] [--project <dir>] [--sessions <dir>]
evogen reject <proposal-id>  [--store <path>] [--project <dir>] [--sessions <dir>]
```

成功输出：

```text
approved proposal prop_01J9…
```

找不到该 id，或状态不是 `draft` 时，输出原因并以退出码 1 结束（例如 `proposal prop_x has status "applied", expected "draft" — nothing done.`）。

### evogen apply

把 `approved` 状态的建议写入宿主文件。逐条执行表达式，打印每笔写入的目标路径与前后摘要。

```bash
evogen apply <proposal-id> [--store <path>] [--project <dir>] [--sessions <dir>]
```

输出示例：

```text
applied  chg_7f3a2b  agents.project · append → /home/you/my-project/AGENTS.md
         digest 9c41e0… → 5d88a1…
status   applied
revert   with `evogen changes` then `evogen revert <change-id>`
```

要点：

- 目标文件在生成 diff 之后被改过 → 该条报「surface changed since the diff was rendered」失败，其余条目照常处理，状态为 `partially_applied`。
- 全部条目失败（没有任何成功写入）时以退出码 1 结束；有任一条成功则退出码 0，失败条目会逐条打印在 stderr。

### evogen changes

列出本地存储里的全部变更记录及其撤销状态：

```bash
evogen changes [--store <path>]
```

```text
chg_7f3a2b  agents.project · append  /home/you/my-project/AGENTS.md
  applied 2026-09-14T06:30:00.000Z  digest 9c41e0… → 5d88a1…
chg_91cc04 [reverted]  agents.user · append  /home/you/.codex/AGENTS.md
  applied 2026-09-14T06:30:01.000Z  digest 77b2af… → c019de…
```

已撤销的记录会在 changeId 后带 `[reverted]` 标记。没有记录时输出 `no changes recorded.`。

### evogen revert

按 changeId 精确移除对应标记块：

```bash
evogen revert <change-id> [--store <path>] [--project <dir>] [--sessions <dir>]
```

成功输出：

```text
reverted chg_7f3a2b — the marked block was removed exactly.
```

changeId 不存在、已撤销过、或该变更不含标记块（replace 操作）时，报错并以退出码 1 结束。

### evogen help / version

`evogen help` 打印内置用法说明；`evogen version` 打印 CLI 包版本号。未知命令会打印用法说明并以退出码 1 结束；漏写必填的 `<proposal-id>` / `<change-id>` 时提示 `usage: evogen <command> <id>` 并以退出码 1 结束。

---

## 模型配置（三级回退）

`proposals` 与 serve 的进化运行都需要调用一个模型端点。evogen 使用**通用的 chat-completions 兼容 HTTP 协议**（`POST {baseUrl}/chat/completions`），不绑定任何模型厂商；接口地址、密钥、模型 ID 全部来自配置。

配置的解析是**逐字段回退**的：接口地址、API Key、模型 ID 三个必需字段各自独立取值，每一级只补当前还缺的字段。三个来源按以下优先级参与回退：

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 1 | 进程环境变量 | `EVOGEN_MODEL_BASE_URL`、`EVOGEN_MODEL_API_KEY`、`EVOGEN_MODEL_ID`，面向高级用户 |
| 2 | 当前工作目录的 `.env.local` | 从仓库根目录的 `.env.example` 复制改名并填入真实值；该文件已被 gitignore，**不要提交真实密钥** |
| 3 | 用户级 `~/.evogen/config.json` | Evogen Studio 设置页保存的配置，是桌面端的默认路径 |

具体规则：

- **同名键之间**，进程环境变量压过 `.env.local`：每个键先取 `process.env`，取不到才看 `.env.local`——shell 里临时导出的值不会被文件悄悄覆盖。
- **字段缺失时逐级补齐**：某个必需字段在前两级都取不到，就用用户级 `config.json` 的对应字段补上；三级都凑不齐该字段才算缺失。
- **来源标签**（Studio 设置页显示的「密钥来源」）：只要进程环境里出现任意一个 `EVOGEN_MODEL_*` 键，标签显示「环境变量」；否则 `.env.local` 里配了接口地址就显示「.env.local 文件」；都没配但用户级配置可用时显示「本页保存的配置」。
- `.env.local` 支持**行内注释**：未加引号的值后可以用 ` # 注释` 结尾，例如 `EVOGEN_MODEL_ID=my-model # 本机部署的模型服务`。加引号（单双皆可）的值按整体取值，不会截断。
- 三个必需键凑不齐时视为「未配置」：CLI 会以退出码 2 打印配置指引；Studio 会引导你去设置页。
- 可选调节：`EVOGEN_MODEL_TIMEOUT_MS`（单次请求超时，默认 120000 毫秒）、`EVOGEN_MODEL_MAX_RETRIES`（失败重试次数，默认 2，只对限流/服务端错误/超时类错误重试）。
- 密钥安全：serve 的配置接口只返回「是否已设置密钥」，永远不回传密钥本身；错误信息中的密钥会被自动打码。

---

## Evogen Studio 桌面端

Evogen Studio 是 evogen 的本地桌面控制台，把整条环路图形化。它通过 sidecar 启动 `evogen serve` 并持有握手令牌，所有数据仍在本机。左侧导航共五页：仪表盘、建议、变更历史、设置、关于。

### 仪表盘：进化环路

顶部是「进化环路」条，把整个闭环摆在最显眼的位置：

1. **收集** — 读取宿主会话日志（显示会话数与可进化面数）；
2. **整理** — 提炼证据、归并成信号；
3. **建议** — 生成待评审的指令改动（显示待处理条数）；
4. **消费** — 确认后写入指令文件（显示写入笔数与已撤销笔数）。

「发起一次进化（只读）」卡片：选择参与分析的会话数（1–200，默认 20），点击「运行进化」。运行中会按阶段实时显示进度（收集/提炼/归并/提议/自检各阶段的条目数与耗时）；完成后展示建议标题、表达式数量、完整性徽章（「运行期间所有可进化面摘要未变，没有写入任何文件」）与模型用量（调用次数、输入/输出 token 数）。点击「查看建议详情」直接跳到建议评审。

「可进化面」卡片以表格列出全部指令文件的 id、类型、大小与路径，缺失的文件也标出来。

尚未配置模型时，仪表盘会出现「先配置模型」引导卡，一键跳转设置页。

### 建议评审页

列出存储中的全部建议，每条显示状态徽章（待审 / 已批准 / 已拒绝 / 已写入 / 部分写入）、id、创建时间、信号数与风险/置信评分。点「查看详情」进入详情弹窗：

- 每条表达式显示目标可进化面、目标路径、理由、写入内容全文与 diff 预览，以及证据来源（信号陈述 + 会话证据条数）。
- **批准**：弹确认框，明示「批准只是标记状态，不会写文件；写入还需在批准后再次确认」。
- **拒绝**：一步完成，只改状态。
- **应用写入**：仅对已批准的建议出现；确认框明示将向几个指令文件追加几个带标记的块。写入完成后展示「写入结果」清单（每笔的 changeId、目标路径、前后摘要）与失败条目，并提示到「变更历史」页可精确撤销。

### 变更历史页

按时间倒序列出每笔写入：changeId、可进化面 id、操作类型、时间、目标路径、前后摘要。未撤销的条目提供「撤销」按钮，点击后需再次确认（与 CLI 的 revert 等价）；已撤销的条目标记「已撤销」徽章，记录保留可查。

### 设置页：模型配置与测试连接

三个字段：**接口地址**（`http(s)://` 开头，通常是 `…/v1` 这样的根路径）、**API Key**（密码框；已配置时显示占位提示「留空表示保持不变」）、**模型 ID**。

- 「保存」把配置写入 `~/.evogen/config.json`（即三级回退的第 3 级）；成功后显示「已保存」徽章和当前**密钥来源**（环境变量 / `.env.local` 文件 / 本页保存的配置）。
- 「测试连接」用当前生效配置发一次极小的真实请求，成功显示「连接正常 ✓」与端点返回的模型名，失败显示具体错误。
- 页面底部提示：高级用户也可以用 `EVOGEN_MODEL_*` 环境变量配置（优先级更高），并显示当前配置状态。

### 关于页：版本与检查更新

显示当前版本号。更新策略：**启动时自动检查一次，之后每 30 分钟轮询**，发现新版本时顶部出现更新横幅；本页也提供手动「检查更新」与「立即更新」（下载进度 → 安装 → 重启生效，与横幅共用同一套状态）。

---

## 本地 API 服务（serve)

```bash
evogen serve [--port <n>] [--project <dir>] [--sessions <dir>]
```

为桌面控制台（或其他本地工具）提供 REST + SSE 接口：

- 只绑定 `127.0.0.1`，不暴露到局域网；
- 启动后向 stdout 打印**一行握手**：`EVOGEN_READY port=<端口> token=<令牌> pid=<进程号>`，此后 stderr 输出监听日志——客户端靠握手行拿到端口与令牌；
- 所有请求需认证：`Authorization: Bearer <令牌>` 头或 `?token=<令牌>` 查询参数，令牌校验失败返回 401；
- 支持 CORS 预检；请求体上限 1 MB；已建立 SSE 连接每 15 秒发一次心跳注释行；
- Ctrl+C / SIGTERM 优雅退出（关闭 SSE 连接与服务）。

主要端点一览：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /api/health` | 存活探针 |
| `GET /api/status` | 可进化面与会话状态（同 `evogen status --json`） |
| `GET /api/surfaces/content?id=<id>` | 读取单个可进化面的内容 |
| `GET /api/config` | 当前生效模型配置（不回传密钥，只返回 `apiKeySet` 与来源） |
| `POST /api/config` | 保存模型配置到 `~/.evogen/config.json` |
| `POST /api/config/test` | 用当前配置发一次连通性测试 |
| `POST /api/runs` | 发起一次只读进化运行（body: `{"sessionLimit": 20}`；有运行中返回 409；未配置模型返回 503） |
| `GET /api/runs/current` | 当前/最近一次运行的状态与结果 |
| `GET /api/proposals`、`GET /api/proposals/:id` | 建议列表 / 单条建议（含 diff 预览） |
| `POST /api/proposals/:id/approve` / `…/reject` | 两段式写入第一阶段（仅 `draft` 可操作，否则 409） |
| `POST /api/proposals/:id/apply` | 第二阶段写入（返回与 CLI apply 相同的报告结构） |
| `GET /api/changes` | 变更记录列表（含已撤销 id 清单） |
| `POST /api/changes/:id/revert` | 精确撤销（失败返回 409 与原因） |
| `GET /api/events` | SSE 事件流：`stage`（阶段进度）、`run-done`、`run-error` |

---

## 常见问题与排错

**`evogen proposals` 退出码 2，提示 needs a model endpoint**
三级配置都没凑齐。按上文「模型配置」任选一级配置好再跑；`.env.local` 必须放在**运行命令时的工作目录**。

**`evogen approve <id>` 说 unknown proposal**
CLI 的写入闭环只作用于存储里的建议。用 `evogen proposals --save` 跑一次并落盘，或在 Studio 里运行进化，之后再操作。

**apply 报 surface changed since the diff was rendered**
生成 diff 之后目标文件被改动了（漂移保护生效）。重新跑一次 `proposals --save`、重新评审并 apply 即可；系统不会基于过期预览写入。

**apply 后建议状态是 partially_applied**
部分表达式成功、部分失败。成功的已各留变更记录可单独 revert；失败原因打印在 stderr（或 Studio 的写入结果清单里），修复后重新处理。

**revert 报 change chg_x used op "replace" and is not wrapped in a marker block**
这条变更用的是 replace 操作（替换已有文本），没有标记块可删。按当初评审过的 diff 手工还原文件。

**serve 返回 401 unauthorized**
缺少或错误的令牌。令牌只在启动时的握手行里出现一次（`EVOGEN_READY port=… token=… pid=…`），以 `Authorization: Bearer <token>` 携带。

**会话数一直是 0**
默认会话根是宿主状态目录下的 `sessions`（默认 `~/.codex/sessions`，可用 `CODEX_HOME` 重定向）。确认宿主确实在该目录留有会话日志，或用 `--sessions <dir>` 显式指定。

**模型请求失败：HTTP 4xx/5xx / timeout**
单次请求超时默认 120 秒，限流与服务端错误自动重试（默认 2 次）。可用 `EVOGEN_MODEL_TIMEOUT_MS` / `EVOGEN_MODEL_MAX_RETRIES` 调整；4xx 错误信息里的密钥已自动打码，可放心贴到 issue 里排查。
