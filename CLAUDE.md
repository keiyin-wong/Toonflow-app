# 本机开发约定

项目规范见 [AGENTS.md](AGENTS.md)，本文件只记录本机的构建与生效流程。

## 改完代码必须构建并让改动生效

改源码后，主动完成对应的构建与安装，不能只改源码就报告完成；验证和汇报以运行中实际加载的文件为准。

本机独立 server 运行的是构建产物，数据目录为仓库根目录 `data/`：

| 改动位置 | 构建 | 让运行中的应用生效 |
| --- | --- | --- |
| `packages/providers`（如 Dreamina） | `apps/server` 下 `bun run build`（复制到 `build/providers`） | 重启 server；按源码哈希自动重装到 `data/providers` |
| `apps/server` | `apps/server` 下 `bun run build` | 重启 server |
| `apps/web` | `apps/web` 下 `bun run build`（输出 `build/web`） | 浏览器 Ctrl+F5 |
| `packages/nodes/*` | 节点目录下 `NODE_ENV=production bun run build`（输出 `build/nodes/<名称>.umd.js`） | 复制到 `data/nodes/`，浏览器 Ctrl+F5 |
| `packages/nodeShared`、`packages/nodeScaffold` | 先 grep 出所有引用改动模块的节点，逐个按上一行构建 | 同上，所有受影响节点都要复制 |
| `packages/tools/*`、`packages/ext/*` | 各自目录下 `bun run build` | 复制到 `data/tools/`、`data/ext/` |

- 节点、tools、ext 由 `initializePlugins` 安装：`data/` 下已有 `initialized` 标记时**不会再从 `build/` 复制**，重启 server 或重跑 `start-toonflow.bat` 都不会更新，必须手动复制 `build/` 中的文件覆盖 `data/` 中的同名文件，并用 `cmp` 确认一致。
- 复制只覆盖同名文件，不删除 `data/` 下的任何文件。

## 启动与重启

- 用户通过双击 `start-toonflow.bat` 启动 server（会执行 `bun install`、`build:server`，然后 `bun run start:server`，端口 3000）。需要重启 server 时，请用户关闭 bat 窗口后重新双击；该 bat 不会更新 `data/nodes` 等插件，插件仍按上表手动复制。
- Claude 在会话中后台启动的 server 会随会话结束而停止，不作为长期运行方式。
- Bun 使用 `%USERPROFILE%\.bun\bin` 下的 1.4.3（与根目录 `package.json` 的 `packageManager` 一致）；旧版 1.3.14 无法运行当前 server 构建（undici 8 缺 `markAsUncloneable`）。
