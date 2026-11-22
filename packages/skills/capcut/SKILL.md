---
name: capcut
description: 把影片放进 CapCut / 剪映。用户说「把影片撞去 / 放进 / 导入 / 丢到 CapCut」「做成剪映草稿」「在 CapCut 里继续剪」，或要查看、修改 CapCut / 剪映草稿（加字幕、调时长、加音乐）时使用。用 capcut 工具在本机草稿目录生成草稿，用户打开 CapCut 即可继续剪辑。
metadata:
  version: "0.1.0"
  displayName: CapCut 剪映草稿
  author: Toonflow
  github: https://github.com/renezander030/capcut-cli
---

# 把影片放进 CapCut / 剪映

capcut 工具调用固定版本的 capcut-cli（非官方，与字节跳动无关），直接在本机 CapCut / 剪映的草稿目录里写草稿。只在装有 CapCut / 剪映的电脑上运行的 Toonflow 可用；服务器上的 Toonflow 不能把草稿写到用户电脑。

## 第一步：准备

1. 调用 `capcutPrepare`。返回的 `draftRoots` 为空表示本机没有 CapCut / 剪映草稿目录：告诉用户先安装并打开过一次 CapCut，不要继续。
2. 草稿目录在剪映（JianyingPro）而不是 CapCut 时，后续每条 capcut 命令的 `args` 都加 `--jianying`。

## 第二步：确定放哪些素材、什么顺序

按用户说法选来源，说不清时用 askUser 问一次：

| 用户说 | 素材来源 |
| --- | --- |
| 「这几个文件」、给了路径 | 用户指定的工作区文件，按给出的顺序 |
| 「画布上的」「星标的」「选中的」 | 画布节点：`findCanvasNodes`（选中的用 `selectedOnly`）→ `getCanvasNodes` 读 `data` 与 `position`。星标节点的 `data.starred` 为 true。从 `data` 里取指向工作区视频 / 图片的相对路径，按阅读顺序排：先按 y（约 80 像素一行）自上而下，行内按 x 自左向右 |
| 「剪辑里的」「时间线」「剪好的」 | `getVideoEditor` 读当前剪辑工程：沿用每个片段的源文件、入点（sourceStart）、时间线起点、时长、速度，以及文字 / 字幕轨 |

拿不到时长时用 `ffprobe` 查（视频取 format.duration，图片默认 3 秒）。不要猜时长。

## 第三步：写草稿规格并编译

1. 用写文件工具把规格写到工作区 `exports/capcut/<草稿名>.json`。时间单位是秒，媒体路径相对规格文件（所以从 `exports/capcut/` 指向 `assets/a.mp4` 要写 `../../assets/a.mp4`），也可以写绝对路径。

```json
{
  "name": "第3集 粗剪",
  "width": 1080, "height": 1920, "fps": 30, "ratio": "9:16",
  "tracks": [
    { "type": "video", "items": [
      { "path": "../../assets/shot01.mp4", "start": 0, "duration": 4.2 },
      { "path": "../../assets/shot02.mp4", "start": 4.2, "duration": 3, "sourceStart": 1.5 },
      { "path": "../../assets/still.png", "start": 7.2, "duration": 2, "type": "photo" }
    ] },
    { "type": "audio", "items": [
      { "path": "../../assets/bgm.mp3", "start": 0, "duration": 0, "volume": 0.4 }
    ] },
    { "type": "text", "items": [
      { "text": "那天，雨下得很大", "start": 0, "duration": 2.5, "fontSize": 12, "y": -0.7 }
    ] }
  ]
}
```

   - 视频轨的片段首尾相接：后一段 `start` = 前一段 `start + duration`。
   - 画幅跟素材或剪辑工程一致（横屏 1920×1080 `16:9`，竖屏 1080×1920 `9:16`）。
   - 音频 `duration: 0` 表示整段；`sourceStart` 是从素材第几秒开始用；`speed` 变速时时长按变速后计算。
   - 字幕有 SRT 文件时，可以编译完再用 `import-srt` 导入，不必逐条写进 text 轨。
2. 先检查：`capcut` `{ command: "compile", args: ["exports/capcut/<草稿名>.json", "--check"] }`。有错按提示修规格再检查。
3. 正式生成：`{ command: "compile", args: ["exports/capcut/<草稿名>.json"] }`。草稿写入默认草稿目录，名字取规格里的 `name`。

## 第四步：告诉用户

说明草稿名、片段数和总时长，并提醒在 CapCut 首页草稿列表里找到这个草稿继续剪辑（结果里有 `editor` 表示 CapCut 已自动关闭并重新打开；原本没开就请用户自己打开）。素材会复制进草稿文件夹，之后移动工作区文件不影响草稿。

CapCut 提示「草稿来自非常规路径」或打不开时（草稿目录里还没有任何 CapCut 自己建的项目时最常见）：

1. 请用户在 CapCut 里新建一个空白项目并取好名字（不用关闭 CapCut，下一步会自动关闭再打开）。
2. 把规格填进这个空项目：`{ command: "compile", args: ["exports/capcut/<草稿名>.json", "--into", "<空项目文件夹名>"] }`。
3. 仍不行时执行 `{ command: "doctor" }` 与 `{ command: "diagnose", project: "<草稿名>" }`，把结果告诉用户。

## 修改已有草稿

- CapCut 开着时写入会被它退出时覆盖。capcut 工具会在写入草稿的命令前**自动关闭** CapCut / 剪映（与点关闭按钮相同，CapCut 会自行保存），写完再**自动打开回来**；原本没开就不会打开。capcut-cli 写入前还会留 `.bak` 备份。
- 用户正在 CapCut 里导出视频、或说了别动 CapCut 时，先问一句再写；用户不想被打断时传 `restartCapcut: false` 并请用户自己关闭。
- 工具报告 CapCut 20 秒内没能关闭时（多半弹了确认框），什么都没写：请用户手动关闭后重试。
- `project` 填草稿文件夹名（`{ command: "projects", args: ["-H"] }` 列出全部草稿）或草稿目录绝对路径。
- 先看再改：`info`、`tracks`、`segments`（加 `-H` 是表格）。改动用 `add-video`、`add-audio`、`add-text`、`import-srt`、`trim`、`speed`、`volume`、`transition` 等；多处修改用 `batch`（`input` 传 JSONL，一条失败整批不写）。
- 不确定命令或参数时先查契约：`{ command: "describe", args: ["--compact"] }`，再 `{ command: "describe", args: ["--command", "<名称>"] }`。转场、滤镜等名称用 `enums`（如 `["--transitions", "-H"]`）查，不要编。

## 限制

- 不可用：`serve`、`translate`、`completions` 和 `--cloud`（会长驻或把内容上传到外部服务）。`caption` 需要本机 Whisper，`render` 只生成低清预览，最终成片在 CapCut 里导出。
- 只写 CapCut / 剪映的草稿目录和工作区 `exports/capcut/`；不要用 `--out` 把草稿写到其他位置，除非用户明确要求。
