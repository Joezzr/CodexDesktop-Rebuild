# Codex Desktop Rebuild — Windows 优化版

[English](README.md) | 简体中文

本分支面向 **Windows 11/10 x64**，目标是在保留 Codex Desktop 核心能力和官方 Windows 壳兼容性的前提下，降低不必要的界面合成、启动扫描和磁盘开销，并提供可直接运行的免安装版本。

仓库默认分支为 `windows-optimized`。后续 Codex 后端合并、Windows 壳适配和性能优化均在该分支持续维护。

## 当前版本组成

- Windows 壳：构建时同步并修补官方 Windows Desktop 壳。
- Codex 后端：固定到 OpenAI Codex `rust-v0.148.0-alpha.9` 的指定提交。
- 构建架构：`x86_64-pc-windows-msvc`。
- 发布形式：单文件自解压免安装 EXE，无需安装 MSIX、注册应用包或安装证书。
- 当前产物：`out/Codex-Windows-x64-0.148.0-alpha.9.exe`。

壳版本与 Codex Rust 后端版本是两个独立维度：同步新壳不会自动改变固定的后端版本；升级后端时也会继续检查与当前壳的协议兼容性。

## Windows 专项优化效果

| 优化项 | 实际处理 | 主要效果 |
| --- | --- | --- |
| 使用不透明窗口表面 | Windows 下的主窗口、辅助窗口、快速聊天和 HUD 不再使用普通 Mica 透明合成路径 | 减少低端显卡、远程桌面和混合 DPI 环境中的合成停顿；窗口拖动、缩放和侧边栏滚动通常更稳定 |
| 减少动态效果 | 启动 Chromium 的 `force-prefers-reduced-motion` 模式 | 减少不必要的过渡动画和合成工作，降低界面切换时的瞬时 GPU 压力 |
| 可控的 GPU 模式 | 默认继续使用硬件加速；支持按需切换为软件渲染 | 正常设备保持流畅度；显卡驱动异常、花屏或 GPU 占用异常时可快速排障和绕开驱动问题 |
| 裁剪非 Windows 资源 | 从最终 Windows 包中删除 Darwin/Linux 可执行文件、Linux CUA 帮助程序、macOS/Linux 插件原生预编译、HIDAPI 源目录和 Snappy 原生文件 | 减少发布包、解压目录和临时目录占用，同时减少启动时杀毒软件需要扫描的无效文件 |
| 剥离 Rust 符号 | `codex.exe` 的 Release 构建启用 `strip=symbols` | 减小后端可执行文件，并降低 app-server 启动时的磁盘读取和安全软件扫描成本 |
| 单文件免安装打包 | 使用 LZMA2 生成自解压 EXE，直接启动未打包的 Owl/Chromium 主程序 | 无需 MSIX 身份、证书和系统级安装；便于复制、备份和在不同目录运行 |
| 固定源码与补丁 | 校验 Codex tag、提交、完整 checkout 和补丁幂等性；官方 code-mode host 同时校验大小与 SHA-256 | 避免“同名版本但源码或二进制不同”，提高后续升级、回退和复现构建的可靠性 |

这些优化最容易在以下场景中感知：

- 集成显卡或较旧的独立显卡；
- 远程桌面、虚拟机或混合刷新率显示器；
- 100%/125%/150% 等混合 DPI 多显示器；
- 项目和历史会话较多、侧边栏需要频繁滚动；
- Windows Defender 或第三方安全软件实时扫描较重。

优化不改变模型推理速度、网络延迟、账号额度或服务端 Codex 权限。最终体感仍会受到电脑配置、项目规模、网络状况、Electron/Chromium 版本和官方服务状态影响，因此项目不承诺固定的帧率、内存或 GPU 降幅。

## GPU 占用与软件渲染

默认模式保留 Chromium 硬件加速。这通常是综合体验最好的选择，因为完全关闭 GPU 后，绘制工作会转移到 CPU，可能导致 CPU 占用升高、滚动变慢或耗电增加。

如果遇到显卡驱动崩溃、花屏、黑屏或 GPU 占用持续异常，可在 PowerShell 中临时使用软件渲染：

```powershell
$env:CODEX_GPU_MODE = "software"
.\Codex-Windows-x64-0.148.0-alpha.9.exe
Remove-Item Env:CODEX_GPU_MODE
```

也可以仅对本次启动传入参数：

```powershell
.\Codex-Windows-x64-0.148.0-alpha.9.exe --software-rendering
```

软件渲染是兼容性兜底选项，不建议在没有 GPU 异常时长期启用。普通模式已经通过不透明窗口和减少动态效果降低了合成负担。

## Windows 功能与兼容性修复

除性能优化外，Windows 构建还包含以下本地兼容性处理：

- 修复新版侧边栏的本地项目模型，迁移旧工作区根目录、项目排序和分组信息；
- 修复账号身份映射，避免壳升级或切换账号后读取到错误的本地账号作用域；
- 在远程 rollout gate 暂时不可用时保留账号作用域内的自定义项目区段；
- 重新打包后更新 Windows 壳使用的 ASAR 完整性信息；
- 将匹配版本的 `codex.exe` 与 `codex-code-mode-host.exe` 注入最终资源目录。

这些修复只处理本地状态、UI 显示和壳/后端兼容性，不会也不能绕过服务端对账号、组织、套餐、地区或功能 rollout 的权限判断。如果界面明确显示无 Codex 访问权限，需要从对应账号或组织管理端处理。

## 免安装版的行为

双击单文件 EXE 后，程序会先把运行文件解压到临时位置，再启动 `ChatGPT.exe`。因此：

- 不会写入 `Program Files`，也不要求管理员权限完成传统安装；
- 第一次启动或安全软件首次扫描时可能比已经解压的目录版稍慢；
- 运行期间仍需要临时磁盘空间，单文件大小不等于运行时实际占用；
- 用户登录、项目列表和会话等状态仍由 Codex/ChatGPT 的用户数据目录管理，不属于程序安装目录。

如更重视启动速度，可直接运行构建生成的目录版：

```text
out\win\Codex-win32-x64\ChatGPT.exe
```

## 构建 Windows x64 版本

准备 Node.js、Rust MSVC 工具链、Visual Studio C++ Build Tools 和 7-Zip，然后执行：

```powershell
npm install
npm run build:win-x64
```

完整命令会依次：

1. 准备并校验固定版本的 Codex Rust 源码；
2. 编译 Windows x64 `codex.exe`；
3. 同步当前官方 Windows 壳；
4. 应用账号、项目侧边栏和 Windows UI 补丁；
5. 执行 Windows 性能优化与非 Windows 资源裁剪；
6. 重建应用并生成单文件免安装 EXE；
7. 检查必要文件、非 Windows 预编译残留、PE 文件头和最终归档内容。

可单独执行以下检查：

```powershell
# 查看 Windows 优化是否已经应用
npm run optimize:win -- --check

# 检查侧边栏项目状态是否需要迁移
npm run repair:win-projects -- --check
```

## 设计取舍

- 不透明表面会牺牲部分 Mica/透明材质观感，换取更稳定的合成性能。
- 减少动态效果会让部分过渡动画更直接。
- 非 Windows 原生资源只从 Windows 发布产物中裁剪；仓库仍保留上游 macOS/Linux 构建能力。
- 单文件版偏向携带方便，目录版偏向更快启动和更少的重复解压。
- 为保证可复现和兼容性，后端不会在构建时盲目追踪最新 alpha，而是经过分析后更新固定版本与补丁集。

## 分支维护方式

- `windows-optimized`：本仓库默认分支，保存 Windows 合并、修复、裁剪和发布流程。
- `upstream/master`：上游重建项目基线，用于定期对比和合并通用更新。
- Codex Rust 上游源码不整份提交到仓库；仓库只保存固定版本元数据和版本化补丁，完整源码使用外部缓存准备。

这种结构可以避免把数千个上游 Rust 文件重复纳入 Git 历史，同时让每次 Windows 构建仍能定位到明确的上游版本。
