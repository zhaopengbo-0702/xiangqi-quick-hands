# 第三方授权与来源

本项目自有源码采用根目录 [LICENSE](LICENSE) 中的 GPL-3.0-or-later。这个声明不替代第三方组件各自的许可证，尤其不将 NNUE 权重重新许可为 GPL。

| 组件 | 用途 | 许可及来源记录 |
| --- | --- | --- |
| 官方 Pikafish Windows 引擎 | 可选本地原生计算 | GPLv3；[来源与对应源码](third_party/pikafish/SOURCE.md)、[许可证](third_party/pikafish/runtime/Copying.txt)、[作者](third_party/pikafish/runtime/AUTHORS) |
| Pikafish WebAssembly | 浏览器内计算 | GPL-3.0-or-later；[许可证](extension/engine/pikafish/LICENSE)、[来源、构建方式与哈希](extension/engine/pikafish/source/SOURCE.md) |
| Pikafish NNUE 权重 | 两种引擎共用的局面评估网络 | **独立 NNUE 许可**；[原文](extension/engine/pikafish/NNUE-License.md) |
| Fairy-Stockfish 兼容性运行时 | 旧版兼容性回归测试 | GPLv3；授权及对应源码位于 `extension/engine`，原始源码归档位于 `third_party/fairy-stockfish-b2e693ef.tar.gz` |
| Lucide 图标 | 扩展按钮和工具图标 | ISC；[许可证](extension/icons/LUCIDE-LICENSE) |

## NNUE 权重

`extension/engine/pikafish/pikafish.nnue` 为第三方模型权重。其随附许可要求合法使用，未经许可不得商用，且适用于由这些权重衍生的权重。请以 [NNUE-License.md](extension/engine/pikafish/NNUE-License.md) 原文为准。

GitHub 将仓库识别为 GPL 项目，不代表权重成为无使用限制的开源资产。发布、再分发或用于其他项目时，保留独立许可，并自行确认拟议用途符合许可。

## 对应源码

原生 Pikafish 的精确发行源码位于 `third_party/pikafish/Pikafish-2026-09-06-source.tar.gz`。浏览器构建的上游源码、封装源码、补丁和构建脚本位于 `extension/engine/pikafish/source`，在 `third_party/pikafish-wasm` 也有开发用副本。Fairy-Stockfish 的对应源码为 `extension/engine/corresponding-source.tar.gz`。

发行包保留其所包含引擎的对应源码和许可材料。更新二进制时，应同步更新精确源码、来源说明和哈希；不得只替换二进制并删除这些材料。
