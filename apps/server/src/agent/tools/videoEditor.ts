import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";

// 剪辑面板（工作区「剪辑」）给 Agent 的操作：经画布通道发到页面，由剪辑面板执行，改动进入撤销记录。
const seconds = z.number().finite().min(0).max(86400);
const itemId = z.string().min(1).max(64);
const itemIds = z.array(itemId).min(1).max(200);
const path = z.string().trim().min(1).max(4096);
const transitionKinds = ["dissolve", "dipBlack", "dipWhite", "flash", "leak", "whip", "blink", "wipe", "push", "slide", "zoom", "circle", "glitch", "spin"] as const;
const direction = z.enum(["left", "right", "up", "down"]);

const videoOp = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("addMedia"), paths: z.array(path).min(1).max(50).describe("工作区相对路径的视频、图片或音频，按顺序放入"),
    track: itemId.optional().describe("目标轨道 ID，省略时视频/图片放 V1（磁性主轨），声音放第一条音频轨"),
    at: seconds.optional().describe("时间线秒数。V1 插入到离它最近的片段边界；其他轨从这里依次排开。V1 省略时追加到末尾"),
  }),
  z.strictObject({ op: z.literal("remove"), ids: itemIds, ripple: z.boolean().default(true).describe("删除后后面的内容前移补位") }),
  z.strictObject({ op: z.literal("split"), at: seconds, ids: itemIds.optional().describe("省略时切开所有未锁定轨道上经过 at 的片段和文字") }),
  z.strictObject({
    op: z.literal("trim"), id: itemId,
    in: seconds.optional().describe("片段新的源文件入点（秒）"), out: seconds.optional().describe("片段新的源文件出点（秒）；图片为显示时长"),
  }),
  z.strictObject({
    op: z.literal("move"), id: itemId, at: seconds.describe("新的时间线位置（秒）；V1 上按位置换顺序"),
    track: itemId.optional().describe("移到另一条同类轨道"),
  }),
  z.strictObject({
    op: z.literal("setClip"), ids: itemIds,
    speed: z.number().min(0.1).max(16).optional(), volume: z.number().min(0).max(4).optional(), muted: z.boolean().optional(), hidden: z.boolean().optional(),
    fit: z.enum(["fit", "fill", "blur"]).optional().describe("比例不同的画面：留黑边/裁切铺满/模糊背景"),
    opacity: z.number().min(0).max(1).optional(), scale: z.number().min(0.05).max(10).optional(),
    x: z.number().min(-1).max(2).optional(), y: z.number().min(-1).max(2).optional(),
    fadeIn: z.number().min(0).max(30).optional(), fadeOut: z.number().min(0).max(30).optional(),
    audioFadeIn: z.number().min(0).max(30).optional(), audioFadeOut: z.number().min(0).max(30).optional(),
    kenBurns: z.boolean().optional().describe("图片缓慢推近（true）或取消（false）"),
  }),
  z.strictObject({
    op: z.literal("transition"), ids: itemIds.describe("V1 上的片段：转场加在它和前一个片段之间"),
    kind: z.enum([...transitionKinds, "cut"]).describe("cut 表示去掉转场"), duration: z.number().min(0.1).max(5).optional(), direction: direction.optional(),
  }),
  z.strictObject({
    op: z.literal("addText"), text: z.string().min(1).max(2000), start: seconds, duration: z.number().min(0.1).max(3600).optional(),
    track: itemId.optional().describe("文字轨 ID，省略时用第一条文字轨"), style: z.enum(["subtitle", "title"]).default("subtitle"),
  }),
  z.strictObject({ op: z.literal("setText"), id: itemId, text: z.string().max(2000).optional(), start: seconds.optional(), duration: z.number().min(0.1).max(3600).optional() }),
  z.strictObject({
    op: z.literal("subtitles"), lines: z.array(z.strictObject({ start: seconds, end: seconds, text: z.string().min(1).max(2000) })).min(1).max(2000),
    track: itemId.optional(), replace: z.boolean().default(true).describe("先清空该文字轨原有字幕"),
  }),
  z.strictObject({
    op: z.literal("format"), width: z.number().int().min(16).max(7680).optional(), height: z.number().int().min(16).max(7680).optional(),
    fps: z.number().int().min(1).max(120).optional(), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
  z.strictObject({ op: z.literal("marker"), time: seconds, label: z.string().max(200).default("") }),
  z.strictObject({ op: z.literal("closeGaps"), track: itemId.optional().describe("省略时为 V1") }),
  z.strictObject({ op: z.literal("addTrack"), kind: z.enum(["video", "audio", "text"]) }),
]);

export const videoSchemas = {
  getVideoEditor: z.strictObject({}),
  openVideoProject: z.strictObject({
    path: z.string().trim().min(1).max(4096).optional().describe("已有剪辑工程路径（getVideoEditor 的 projects）"),
    create: z.string().trim().min(1).max(120).optional().describe("新建工程的名称"),
  }).refine(value => !!value.path !== !!value.create, "path 和 create 二选一"),
  editVideo: z.strictObject({
    revision: z.string().min(1).max(200).describe("最近一次 getVideoEditor/editVideo 返回的 revision；用户在此期间改过工程时拒绝执行"),
    ops: z.array(videoOp).min(1).max(100),
  }),
  exportVideo: z.strictObject({
    format: z.enum(["mp4", "gif", "mp3", "wav"]).default("mp4"), quality: z.enum(["high", "medium", "small"]).default("high"),
    scale: z.number().min(0.1).max(1).optional(), range: z.strictObject({ start: seconds, end: seconds }).optional(),
  }),
};
export type VideoOperationName = keyof typeof videoSchemas;
export const isVideoOperation = (name: string): name is VideoOperationName => Object.hasOwn(videoSchemas, name);

const descriptions: Record<VideoOperationName, [string, string]> = {
  getVideoEditor: ["读取剪辑", "打开工作区的「剪辑」面板并读取当前剪辑工程：工程列表、画幅、轨道、片段（id、轨道、源文件、入出点、时间线起止、速度、转场）、文字/字幕、标记、总时长和 revision。剪辑前先调用。"],
  openVideoProject: ["打开剪辑工程", "打开已有剪辑工程（path）或新建一个（create）并切换过去，返回与 getVideoEditor 相同的内容。没有工程时先新建。"],
  editVideo: ["编辑剪辑", "按顺序执行一批剪辑操作，整批算一次撤销；任一项失败则整批不生效。必须带最新 revision。时间单位均为秒。返回修改后的工程内容和新 revision。"],
  exportVideo: ["导出剪辑", "把当前剪辑工程导出到工作区 exports/（MP4/GIF/MP3/WAV），等待完成后返回输出路径。耗时较长，只在用户要导出时调用。"],
};

const guidelines = [
  "剪辑流程：getVideoEditor 看工程 → 没有工程用 openVideoProject{create} → 素材来自画布节点的输出（findCanvasNodes 找视频/图片/音频节点，getCanvasNodes fields:['outputs'] 读取工作区路径）或工作区文件 → editVideo 一次提交一批操作 → 用户要成片时 exportVideo。",
  "V1 是磁性主轨：片段首尾相接，顺序即成片顺序；addMedia 不给 at 时追加到末尾，按分镜顺序粗剪时一次 addMedia 传入全部路径。画中画、B-roll 放 V2 等上层视频轨（addTrack 新建），配乐和音效放音频轨，字幕放文字轨。",
  "对白字幕用 subtitles 按时间批量写入；标题用 addText style:'title'。镜头间默认硬切，只在用户要求或情绪转换处加 transition（dissolve 叠化、dipBlack 黑场）。",
  "每次 editVideo 用上一次返回的 revision；被拒绝时重新 getVideoEditor，基于最新内容重做，不要覆盖用户的手动修改。不要直接改剪辑工程 JSON 文件。",
];

export function createVideoEditorTools(canvas?: CanvasContext): ToolDefinition[] {
  if (!canvas) return [];
  return (Object.keys(videoSchemas) as VideoOperationName[]).map(name => ({
    name, label: descriptions[name][0], description: descriptions[name][1],
    promptGuidelines: name === "getVideoEditor" ? guidelines : [],
    parameters: z.toJSONSchema(videoSchemas[name], { io: "input", target: "draft-07" }),
    executionMode: "sequential" as const,
    async execute(_id: string, params: unknown, signal?: AbortSignal) {
      const result = await canvas.call({ name, args: videoSchemas[name].parse(params) as Record<string, unknown> }, signal);
      return { content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }], details: result };
    },
  }));
}
