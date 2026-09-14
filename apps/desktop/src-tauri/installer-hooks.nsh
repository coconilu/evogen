; 安装/卸载前，结束所有从安装目录运行的残留进程（sidecar 等）。
; Tauri 的 NSIS 模板默认只处理主程序进程；随包的 sidecar（如 binaries\evogen-cli.exe）
; 在主程序被升级器结束后可能残留，把文件锁住导致覆盖安装报
; "Error opening file for writing"。
;
; 用法：放到 src-tauri/ 下，tauri.conf.json 里挂
;   "bundle": { "windows": { "nsis": { "installerHooks": "./installer-hooks.nsh" } } }
;
; 实现要点（均已实测）：
; - 外层用双引号 + $\" 转义：NSIS 单引号字符串里 '' 不是转义，会被拆成多个参数
; - 用 CIM 而非 Get-Process：安装器是 32 位，Get-Process 读不到 64 位进程的 .Path，
;   CIM 的 WMI provider 是 64 位，ExecutablePath 跨位数可见
; - 匹配整个 $INSTDIR 子树（不限定 resources\）：资源映射的落盘布局由
;   tauri.conf.json 的 bundle.resources 决定（本项目 sidecar 在 binaries\ 下），
;   钩子必须跟实际布局走而不是写死某个子目录；排除 uninstall.exe（卸载器自身）
; - 主程序进程留给模板自带的 CheckIfAppIsRunning 弹提示处理

!macro KillInstallDirProcesses
  nsExec::ExecToLog "powershell -NoProfile -ExecutionPolicy Bypass -Command $\"Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR\', [StringComparison]::OrdinalIgnoreCase) -and $$_.ExecutablePath -inotlike '*\uninstall.exe' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\""
  Pop $0
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillInstallDirProcesses
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillInstallDirProcesses
!macroend
