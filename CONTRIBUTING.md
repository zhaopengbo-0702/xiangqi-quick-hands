# 参与开发

## 开发环境

- Node.js 22。
- Python 3.9 或更新版本；Windows 原生引擎集成测试需要 64 位 Windows。
- Chrome / Edge 116 或更新版本，用于加载 `extension`。
- Windows PowerShell，用于安装本地组件与生成发行包。

克隆仓库后即可执行检查，目前没有需要通过 `npm install` 安装的项目依赖：

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run package
```

在 PowerShell 之外可以使用 `npm test` 和 `npm run check`。非 Windows 系统会跳过 Windows 原生引擎集成测试；浏览器独立版仍可在支持 Manifest V3 和所需 WebAssembly 功能的浏览器中加载。

## 修改与验证

请围绕具体问题提交修改，并说明复现步骤、预期行为和验证结果。修改棋盘读取、自动行棋、取消或引擎通信时，应覆盖对应的回归场景。自动落子前的局面校验、超时校验和取消检查必须保留。

可选的 `scripts/browser-smoke.cjs` 需要另行提供 Playwright 与 Chromium，通过本地夹具验证真实扩展。不要用公开真人匹配执行自动化测试。截图与日志放入被 Git 忽略的 `test-results`，提交问题时移除账号、对局链接等个人信息。

## 引擎与发行

`extension/engine/pikafish/pikafish.nnue` 是原生与浏览器共用的网络。更新引擎或网络时，保持版本匹配，更新校验值、对应源码、构建补丁和来源说明，并重新运行测试与打包。

`npm run package` 只生成浏览器独立安装包，文件名统一为 `xiangqi-quick-hands-v<版本号>.zip`，版本号读取扩展清单并与 `package.json` 核对；例如当前生成 `xiangqi-quick-hands-v2.5.0.zip`。发行包适合放在 GitHub Releases，不提交到源码历史，`SHA256SUMS.txt` 中必须使用相同的带版本号文件名，发布说明和下载链接也须同步。包内保留 WASM、NNUE、对应源码、补丁与许可证，不再生成 Windows 完整包。下载缓存、重复网络和展开的上游源码工作树由 `.gitignore` 排除；重建所需的源码归档、补丁、许可证与构建说明随仓库保留。

## 原生兼容性与开发检查

源码保留官方 `Pikafish-2026-09-06` Windows universal 运行时、原生通信和兼容性测试。原生模式默认 4 线程、128 MiB 置换表；浏览器独立版无需安装这些组件。已有本地主机的旧安装仍会优先连接它，不可用时自动使用浏览器引擎。

调试原生通道时，在加载仓库的 `extension` 后运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-pikafish.ps1`，需要 Windows 64 位与 Python 3.9 或更新版本。安装器读取插件 ID，校验引擎和网络 SHA-256，并仅在当前用户的 Edge、Chrome 和 Chromium Native Messaging 注册表项登记主机；配置位于 `%LOCALAPPDATA%\XiangqiQuickHands\PikafishHost`。仅已登记插件 ID 可通过标准输入输出访问。移动仓库后需重新注册；运行 `scripts/uninstall-pikafish.ps1` 可卸载登记，保留引擎与源码。

可选本机检查服务为 `npm.cmd run verify`，默认地址 `http://127.0.0.1:8791`；被占用时尝试 8792，以启动输出为准。首页检查本机皮卡鱼和 NNUE，`/wasm` 为旧版兼容性测试；检查通过不代表浏览器扩展已连接。正常浏览器行棋不依赖此服务，未启动时该网址会拒绝连接。

项目源码遵循 GPL-3.0-or-later。提交贡献时请确认有权按该许可提供代码；第三方组件继续保留各自授权。NNUE 权重不属于项目的 GPL 授权范围，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
