# Changelog

## v0.0.2（2026-09-13）

- fix(release): 将 src-tauri 整体排除出 Biome——版本 bump 重写 JSON 后不再与格式化打架
- feat(release): 一键发版流水线落地，minisign 签名密钥接入
- docs: M2 关账，插入 M4 桌面控制台里程碑；架构文档补写入闭环与客户端形态
- feat(m2): 写入闭环——两段式 apply、变更记录、精确撤销（CLI + serve + 平台）
- feat(desktop): SEA 独立 sidecar 二进制 + NSIS 安装器钩子，发布级构建跑通
- fix(cli,kernel): M1 真实验收通过；修复 dotenv 行内注释与阶段错误可见性
- fix(desktop): 补 updater 插件必需配置与 serde_json 依赖，tauri dev 实测跑通
- feat(desktop): Evogen Studio 桌面控制台骨架（Tauri v2 + 薄 Rust 壳 + Node sidecar）
- chore: 引入 Biome 质量门禁并统一全仓格式；补提交适配器测试
- cli: 新增 evogen serve 本地 API（供桌面控制台使用）
- ci: 引入 vitest 测试与内核纯净性扫描
- cli: 新增 evogen proposals 只读命令（建议 + diff 预览）
- kernel: 实现五阶段进化流水线与默认运行时
- docs: M0 验收通过，标记骨架里程碑完成
- ci: 由 package.json 的 packageManager 决定 pnpm 版本
- chore: 初始化 evogen monorepo（内核 / 适配器 / CLI 骨架）

