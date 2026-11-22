import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "capcut",
  displayName: "CapCut 剪映草稿",
  description: "用固定版本的 capcut-cli 在本机 CapCut / 剪映草稿目录中新建、查看和修改草稿，把工作区的视频、图片、声音和字幕放进 CapCut。",
  author: "Toonflow",
  github: "https://github.com/renezander030/capcut-cli",
  prompt: `capcut 工具调用固定版本 capcut-cli 0.36.0（非官方、与字节跳动无关）。未就绪时先调用 capcutPrepare。
把影片放进 CapCut / 剪映前先读取 capcut 技能。新建草稿用 compile：先把 JSON 规格写入工作区，再调用 capcut 的 compile 并传入规格路径；规格里的媒体路径相对规格文件。写入草稿时工具会自动关闭正在运行的 CapCut，写完再打开回来；写入后告诉用户在 CapCut 里打开哪个草稿。
不确定命令或参数时先用 describe --compact 和 describe --command <名称> 查询契约，不要猜测参数。只在本机装有 CapCut / 剪映时可用。`,
  configRules: [],
}, import.meta.url);
