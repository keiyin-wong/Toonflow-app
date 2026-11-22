import { z } from "zod";
import type { ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import { closeEditor, reopenEditor, writesDrafts } from "./app";
import { draftDirectories, prepareCapcut, runCapcut, version } from "./runtime";

const configSchema = z.strictObject({});
const runSchema = z.strictObject({
  command: z.string().trim().min(1).max(64).describe("capcut-cli 命令名，如 projects、info、compile、add-video、describe"),
  project: z.string().trim().min(1).max(1024).optional().describe("草稿：草稿文件夹名（在 CapCut / 剪映草稿目录中查找）或草稿目录的绝对路径。不需要草稿的命令（projects、compile、describe、enums、doctor）不填"),
  args: z.array(z.union([z.string().max(4096), z.number(), z.boolean()])).max(64).default([]).describe("命令的其余参数，按命令行顺序逐个传入，如 [\"specs/capcut.json\"] 或 [\"--start\",\"2s\"]。工作区内的文件用相对路径"),
  input: z.string().max(1024 * 1024).optional().describe("写入标准输入的文本，仅 batch 等读取标准输入的命令使用"),
  restartCapcut: z.boolean().default(true).describe("写入草稿的命令执行前自动关闭正在运行的 CapCut / 剪映，执行后重新打开（仅 Windows）。用户要求不要动 CapCut 时设为 false"),
});

// 长驻进程或把内容发到外部服务的命令不开放给智能体。
const blockedCommands = new Set(["serve", "translate", "completions"]);

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools(context) {
    configSchema.parse(context.config);
    return [{
      name: "capcutPrepare",
      label: "准备 CapCut 工具",
      description: `安装固定版本 capcut-cli ${version} 到插件私有目录（首次需要联网，约数秒）。不改动任何草稿。capcut 工具提示未就绪时调用一次。`,
      parameters: z.toJSONSchema(z.strictObject({}), { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, _params, signal) {
        const result = await prepareCapcut(signal);
        const roots = draftDirectories();
        const text = JSON.stringify({ ...result, draftRoots: roots });
        return { content: [{ type: "text" as const, text }], details: { ...result, draftRoots: roots } };
      },
    }, {
      name: "capcut",
      label: "CapCut 草稿",
      description: "运行 capcut-cli 命令，在本机 CapCut / 剪映草稿目录中新建、查看和修改草稿。工作目录是当前工作区，相对路径指工作区文件。返回退出码、JSON 输出和错误输出。",
      promptSnippet: "把工作区的视频、图片、声音、字幕做成 CapCut / 剪映草稿，或查看、修改已有草稿。",
      promptGuidelines: [
        "先读 capcut 技能再操作。新建草稿：写 JSON 规格到工作区，先 compile <规格> --check 检查，再 compile <规格>。",
        "写入草稿的命令会自动关闭正在运行的 CapCut / 剪映，写完再打开回来（CapCut 关闭时会自行保存）；用户正在 CapCut 里导出或不想被打断时先问一句，或设 restartCapcut=false 并请用户自己关闭。capcut-cli 会保留 .bak 备份。剪映草稿加参数 --jianying。",
        "serve、translate、completions 命令和 --cloud 参数不可用（会长驻或把内容发到外部服务）。",
      ],
      parameters: z.toJSONSchema(runSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const request = runSchema.parse(params);
        if (blockedCommands.has(request.command)) throw new Error(`capcut ${request.command} 不对智能体开放`);
        if (request.args.some(arg => typeof arg === "string" && /^--cloud(=|$)/.test(arg))) throw new Error("--cloud 会把音频上传到字节跳动服务，不对智能体开放");
        // CapCut 开着时写入会被它退出时覆盖：先自动关闭，写完（无论成败）再打开回来。
        const closed = request.restartCapcut && writesDrafts(request.command, request.args) ? await closeEditor(signal) : null;
        let result: Awaited<ReturnType<typeof runCapcut>>;
        try {
          result = await runCapcut({ ...request, cwd: context.cwd || undefined }, signal);
        } finally {
          if (closed) reopenEditor(closed);
        }
        const editor = closed ? { closedAndReopened: closed.name, reopened: !!closed.launcher } : undefined;
        const text = JSON.stringify({
          ok: result.ok,
          status: result.status,
          ...(editor ? { editor } : {}),
          ...(result.project ? { project: result.project } : {}),
          ...(result.json !== undefined ? { output: result.json } : { stdout: result.stdout }),
          ...(result.stderr ? { stderr: result.stderr } : {}),
        });
        return { content: [{ type: "text" as const, text }], details: { ...result, ...(editor ? { editor } : {}) } };
      },
    }];
  },
};

export default plugin;
