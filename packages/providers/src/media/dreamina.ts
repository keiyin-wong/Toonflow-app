// Dreamina (即梦画布) 本地 CLI 作为 Toonflow 媒体模型供应商。
// 通过宿主注入的 tool.exec 调用 dreamina-canvas 命令行；凭证由 CLI 自行管理（系统凭据库）。
// 依赖：已安装 dreamina-canvas 并完成 auth login；估价在桥接画布上保存节点后 node quote，不生成、不扣费。

const rules = [
  {
    type: "input",
    field: "cliPath" as const,
    title: "CLI 路径",
    value: "dreamina-canvas",
    props: { placeholder: "dreamina-canvas 或 C:/Users/<用户>/bin/dreamina-canvas.exe" },
  },
  {
    type: "input",
    field: "profile" as const,
    title: "登录配置",
    value: "default",
    props: { placeholder: "dreamina-canvas auth profile，默认 default" },
  },
  {
    type: "inputNumber",
    field: "creditCeiling" as const,
    title: "单次生成积分上限",
    value: 200,
    props: { min: 1, precision: 0, placeholder: "超过该积分报价时停止生成" },
  },
  {
    type: "input",
    field: "bridgeCanvasName" as const,
    title: "桥接画布名",
    value: "Toonflow",
    props: { placeholder: "Dreamina 侧用于估价与生成的画布名称" },
  },
] as const;

type ReferencedImageRequest = ImageRequest & {
  referenceOrder?: ({ type: "image"; index: number } | { type: "text" })[];
};
type ReferencedVideoRequest = VideoRequest & {
  referenceOrder?: ({ type: "image" | "video" | "audio"; index: number } | { type: "firstFrame" | "lastFrame" | "text" })[];
};

interface CliEnvelope<T> {
  schemaVersion: string;
  ok: boolean;
  data?: T;
  error?: { code?: number; message?: string; diagnostics?: { detail?: string }[] };
}

const mimeExt: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
  "audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/flac": ".flac",
};

function cfg(context: ProviderContext) {
  const cliPath = String(context.config.cliPath ?? "").trim() || "dreamina-canvas";
  const profile = String(context.config.profile ?? "").trim() || "default";
  const ceiling = Number(context.config.creditCeiling);
  const creditCeiling = Number.isFinite(ceiling) && ceiling >= 1 ? Math.floor(ceiling) : 200;
  const bridgeCanvasName = String(context.config.bridgeCanvasName ?? "").trim() || "Toonflow";
  return { cliPath, profile, creditCeiling, bridgeCanvasName };
}

async function cli<T>(context: ProviderContext, args: string[], options?: {
  inputFiles?: { data: Uint8Array; name: string }[];
  readOutputs?: boolean;
  timeoutMs?: number;
}): Promise<T> {
  const { cliPath, profile } = cfg(context);
  const baseArgs = args.includes("--format") ? ["--profile", profile, ...args] : ["--format", "json", "--profile", profile, ...args];
  const result = await context.tool.exec({
    executable: cliPath,
    args: baseArgs,
    inputFiles: options?.inputFiles,
    readOutputs: options?.readOutputs,
    timeoutMs: options?.timeoutMs ?? 120_000,
  });
  if (result.exitCode === 11) {
    throw Object.assign(new Error(`Dreamina 需要登录：请在终端运行 ${cliPath} auth login 完成授权后重试`), { code: "MEDIA_TASK_FAILED" });
  }
  let parsed: CliEnvelope<T> | undefined;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("{\"schemaVersion\"")) {
      try { parsed = JSON.parse(line) as CliEnvelope<T>; } catch { parsed = undefined; }
    }
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
    throw Object.assign(new Error(`Dreamina CLI 输出无法解析（exit ${result.exitCode}）：${(result.stderr || result.stdout || "无输出").slice(0, 300)}`), { code: "MEDIA_TASK_FAILED" });
  }
  if (!parsed.ok) {
    const detail = parsed.error?.diagnostics?.map(item => item.detail).filter(Boolean).join("；") ?? "";
    throw Object.assign(new Error(`Dreamina：${parsed.error?.message ?? "未知错误"}${detail ? `（${detail}）` : ""}`), { code: "MEDIA_TASK_FAILED" });
  }
  const data = parsed.data as T;
  // readOutputs 的文件字节挂在 CLI JSON 数据之外，由宿主 exec 返回；合并供调用方直接取用。
  if (options?.readOutputs) return Object.assign(data as object, { outputs: result.outputs ?? [] }) as T;
  return data;
}

function wait(context: ProviderContext, ms: number) {
  context.signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { context.signal?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(context.signal!.reason); };
    context.signal?.addEventListener("abort", abort, { once: true });
  });
}

function uuid() {
  let value = "";
  for (let index = 0; index < 36; index++) {
    if (index === 8 || index === 13 || index === 18 || index === 23) value += "-";
    else if (index === 14) value += "4";
    else {
      const random = Math.floor(Math.random() * 16);
      value += (index === 19 ? (random & 0x3) | 0x8 : random).toString(16);
    }
  }
  return value;
}

async function bytesOf(context: ProviderContext, input: MediaInput): Promise<{ data: Uint8Array; mimeType: string; name?: string }> {
  if (input.type === "binary") return { data: input.data, mimeType: input.mimeType, name: input.name };
  const fromBase64 = (value: string, mime: string) => {
    const comma = value.indexOf(",");
    const head = value.startsWith("data:") ? value.slice(5, value.indexOf(";")) : "";
    const raw = value.startsWith("data:") ? value.slice(comma + 1) : value;
    return { data: Uint8Array.from(Buffer.from(raw.replace(/\s/g, ""), "base64")), mimeType: head || mime };
  };
  if (input.type === "base64") return { ...fromBase64(input.data, input.mimeType), name: input.name };
  if (input.url.startsWith("data:")) return { ...fromBase64(input.url, input.mimeType ?? ""), name: input.name };
  const response = await context.tool.fetch(input.url, { signal: context.signal });
  if (!response.ok) throw Object.assign(new Error(`读取参考素材失败：HTTP ${response.status}`), { code: "MEDIA_TASK_FAILED" });
  const mimeType = input.mimeType || (response.headers.get("content-type") ?? "").split(";")[0].trim() || "application/octet-stream";
  return { data: new Uint8Array(await response.arrayBuffer()), mimeType, name: input.name };
}

interface BridgeCanvas { projectId: string; cliPath: string; }
let bridgeCache: BridgeCanvas | undefined;
// CLI 拒绝重复的 ref 值，多参考图估价需逐个不同的占位资源；按索引缓存复用。
const placeholderCache = new Map<string, string[]>();

let quoteQueueTail: Promise<unknown> = Promise.resolve();

// 估价共用一个占位节点与占位资源，参数变更需串行覆盖后立即报价，避免并发估价互相覆盖。
function runQuoteSerially<T>(task: () => Promise<T>): Promise<T> {
  const next = quoteQueueTail.then(task, task);
  quoteQueueTail = next.catch(() => undefined);
  return next;
}

async function bridge(context: ProviderContext): Promise<string> {
  const { cliPath, bridgeCanvasName } = cfg(context);
  if (bridgeCache?.cliPath === cliPath) return bridgeCache.projectId;
  const list = await cli<{ items?: { projectId?: string; name?: string }[] }>(context, ["canvas", "ls", "--limit", "50", "--format", "json"]);
  const found = list.items?.find(item => item.projectId && item.name === bridgeCanvasName);
  if (found?.projectId) {
    bridgeCache = { projectId: found.projectId, cliPath };
    return found.projectId;
  }
  const created = await cli<{ project?: { projectId?: string } }>(context, ["canvas", "create", bridgeCanvasName, "--format", "json"]);
  const projectId = created.project?.projectId;
  if (!projectId) throw Object.assign(new Error("Dreamina 桥接画布创建失败：未返回 projectId"), { code: "MEDIA_TASK_FAILED" });
  bridgeCache = { projectId, cliPath };
  return projectId;
}

// 1x1 透明 PNG：仅用于满足图生模式的引用下限；已验证报价只按参数计价，与素材内容无关（ACT 假设，如后续报价随内容变化需改为真实素材估价）。
const placeholderPng = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);

async function placeholderResources(context: ProviderContext, projectId: string, count: number): Promise<string[]> {
  const { cliPath } = cfg(context);
  const key = `${cliPath}@${projectId}`;
  const cached = placeholderCache.get(key) ?? [];
  while (cached.length < count) {
    const uploaded = await cli<{ resourceId?: string }>(context, [
      "resource", "upload", "--file", "{{file:0}}", "--name", `toonflow-quote-placeholder-${cached.length + 1}`, "--project-id", projectId, "--format", "json",
    ], { inputFiles: [{ data: placeholderPng, name: "placeholder.png" }] });
    const resourceId = uploaded.resourceId;
    if (!resourceId) throw Object.assign(new Error("Dreamina 占位资源上传失败"), { code: "MEDIA_TASK_FAILED" });
    cached.push(resourceId);
  }
  placeholderCache.set(key, cached);
  return cached.slice(0, count);
}

async function uploadMedia(context: ProviderContext, input: MediaInput, projectId: string, name: string): Promise<string> {
  const { data, mimeType } = await bytesOf(context, input);
  const ext = mimeExt[mimeType.toLowerCase()] ?? (/\.[a-z0-9]{2,4}$/i.exec(input.name ?? "") ?? [".bin"])[0].toLowerCase();
  const uploaded = await cli<{ resourceId?: string }>(context, [
    "resource", "upload", "--file", `{{file:0}}`, "--name", name, "--project-id", projectId, "--format", "json",
  ], { inputFiles: [{ data, name: `ref${ext}` }], timeoutMs: 300_000 });
  const resourceId = uploaded.resourceId;
  if (!resourceId) throw Object.assign(new Error(`参考素材上传失败：${mimeType}`), { code: "MEDIA_TASK_FAILED" });
  return resourceId;
}

interface QuoteResult { totalMaxCredits?: number; items?: { maxCredits?: number; error?: { message?: string } }[]; }

function quoteResult(quote: QuoteResult): ProviderPrice | null {
  const item = quote.items?.[0];
  if (item?.error) return { price: "无法估价", tips: item.error.message ?? "" };
  const credits = quote.totalMaxCredits ?? item?.maxCredits;
  if (typeof credits !== "number") return null;
  return { price: `≈${credits} 积分`, tips: "即梦报价（本次最多消耗）；实际扣费以即梦记录为准" };
}

function buildGenerationArgs(kind: "image" | "video", params: {
  prompt: string;
  model: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  count?: number;
  mode?: string;
  refs: string[];
}): string[] {
  const args: string[] = [kind];
  if (params.prompt) args.push("--prompt", params.prompt);
  if (params.mode) args.push("--mode", params.mode);
  args.push("--model", params.model);
  if (params.ratio) args.push("--ratio", params.ratio);
  if (params.resolution) args.push("--resolution", params.resolution);
  if (kind === "video" && params.duration && params.duration !== 5) args.push("--duration", String(params.duration));
  if (kind === "image" && params.count && params.count > 1) args.push("--count", String(params.count));
  for (const ref of params.refs) args.push("--ref", ref);
  return args;
}

async function quoteParams(context: ProviderContext, kind: "image" | "video", params: {
  prompt: string;
  model: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  count?: number;
  mode?: string;
  referenceCount: number;
}): Promise<QuoteResult> {
  return runQuoteSerially(async () => {
    const projectId = await bridge(context);
    const found = await cli<{ items?: { nodeId?: string }[] }>(context, [
      "node", "find", "--name", `toonflow quote ${kind}`, "--type", kind, "--limit", "1", "--project-id", projectId, "--format", "json",
    ]);
    let refs: string[] = [];
    if (params.referenceCount > 0) {
      refs = (await placeholderResources(context, projectId, params.referenceCount)).map(id => `res:${id}`);
    }
    const generationArgs = buildGenerationArgs(kind, { ...params, refs });
    let nodeId = found.items?.[0]?.nodeId;
    if (nodeId) {
      await cli(context, ["node", "edit", ...generationArgs, "--node-id", nodeId, "--project-id", projectId, "--format", "json"]);
    } else {
      const created = await cli<{ node?: { nodeId?: string } }>(context, [
        "node", "create", ...generationArgs, "--title", `toonflow quote ${kind}`, "--project-id", projectId, "--format", "json",
      ]);
      nodeId = created.node?.nodeId;
    }
    if (!nodeId) throw Object.assign(new Error("Dreamina 估价节点创建失败"), { code: "MEDIA_TASK_FAILED" });
    return cli<QuoteResult>(context, ["node", "quote", "--node-id", nodeId, "--project-id", projectId, "--format", "json"]);
  });
}

interface OperationStatus { state?: string; resources?: { resourceId?: string }[]; }

async function pollAndDownload(context: ProviderContext, projectId: string, submitId: string, mediaType: "image" | "video"): Promise<MediaAsset[]> {
  const deadline = Date.now() + 60 * 60_000;
  // 轮询期间的瞬时网络错误不终止等待中的任务；连续失败超过该次数才放弃。
  let transientFailures = 0;
  while (true) {
    context.signal?.throwIfAborted();
    if (Date.now() > deadline) throw Object.assign(new Error("Dreamina 生成超时（60 分钟）"), { code: "MEDIA_TASK_FAILED" });
    let status: OperationStatus;
    try {
      status = await cli<OperationStatus>(context, [
        "operation", "status", submitId, "--project-id", projectId, "--format", "json",
      ], { timeoutMs: 60_000 });
      transientFailures = 0;
    } catch (error) {
      if (++transientFailures > 6) throw error;
      await wait(context, 10_000);
      continue;
    }
    const state = String(status.state ?? "");
    if (state === "succeeded" || state === "partial_success") {
      const resourceIds = (status.resources ?? []).map(item => item.resourceId).filter((id): id is string => !!id);
      if (!resourceIds.length) throw Object.assign(new Error("Dreamina 任务成功但没有输出资源"), { code: "MEDIA_TASK_FAILED" });
      const assets: MediaAsset[] = [];
      for (const resourceId of resourceIds) {
        const downloaded = await cli<{ outputs?: { name: string; data: Uint8Array }[] }>(context, [
          "resource", "download", resourceId, "--project-id", projectId, "--output", "{{dir}}", "--format", "json",
        ], { readOutputs: true, timeoutMs: 600_000 });
        const file = downloaded.outputs?.find(item => item.data?.length) ?? downloaded.outputs?.[0];
        if (!file?.data?.length) throw Object.assign(new Error(`Dreamina 资源 ${resourceId} 下载失败`), { code: "MEDIA_TASK_FAILED" });
        const ext = /\.[a-z0-9]+$/i.exec(file.name)?.[0] ?? "";
        const mimeType = Object.entries(mimeExt).find(([, value]) => value === ext)?.[0] ?? `${mediaType}/mp4`;
        assets.push({ mediaType, type: "binary", data: file.data, mimeType, name: file.name });
      }
      return assets;
    }
    if (state === "failed" || state === "canceled") {
      throw Object.assign(new Error(`Dreamina 生成${state === "failed" ? "失败" : "已取消"}`), { code: "MEDIA_TASK_FAILED" });
    }
    await wait(context, 5_000);
  }
}

interface GenerationIdentity { kind: "image" | "video"; projectId: string; nodeId: string; submitId: string; }

async function runGeneration(context: ProviderContext, kind: "image" | "video", params: {
  prompt: string;
  model: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  count?: number;
  mode?: string;
  refs: string[];
}): Promise<MediaAsset[]> {
  const { creditCeiling } = cfg(context);
  const projectId = await bridge(context);
  const submitId = uuid();
  const generationArgs = buildGenerationArgs(kind, params);
  const created = await cli<{ node?: { nodeId?: string } }>(context, [
    "node", "create", ...generationArgs, "--title", "toonflow", "--run", "--yes",
    "--credit-ceiling", String(creditCeiling), "--submit-id", submitId, "--project-id", projectId, "--format", "json",
  ], { timeoutMs: 300_000 });
  const nodeId = created.node?.nodeId;
  if (!nodeId) throw Object.assign(new Error("Dreamina 节点创建失败：未返回 nodeId"), { code: "MEDIA_TASK_FAILED" });
  await context.saveTaskData?.({ kind, projectId, nodeId, submitId } satisfies ProviderTaskData);
  return pollAndDownload(context, projectId, submitId, kind);
}

function resolveVideoMode(mode: VideoMode | undefined, request: ReferencedVideoRequest) {
  const frames = [
    ...(request.firstFrame ? ["first"] : []),
    ...(request.lastFrame ? ["last"] : []),
  ];
  const chosen = mode ?? (frames.length === 2 ? "startEndRequired" : frames.length === 1 ? "startFrameOptional" : (request.images?.length ?? 0) + (request.videos?.length ?? 0) + (request.audios?.length ?? 0) > 0 ? [] : "text");
  if (Array.isArray(chosen)) return "m2v" as const;
  if (chosen === "text") return "t2v" as const;
  return "first_last_frame" as const;
}

async function uploadVideoReferences(context: ProviderContext, request: ReferencedVideoRequest, projectId: string) {
  const first = request.firstFrame ? await uploadMedia(context, request.firstFrame, projectId, "toonflow first frame") : undefined;
  const last = request.lastFrame ? await uploadMedia(context, request.lastFrame, projectId, "toonflow last frame") : undefined;
  const images: string[] = [];
  for (const [index, input] of (request.images ?? []).entries()) images.push(await uploadMedia(context, input, projectId, `toonflow ref image ${index + 1}`));
  const videos: string[] = [];
  for (const [index, input] of (request.videos ?? []).entries()) videos.push(await uploadMedia(context, input, projectId, `toonflow ref video ${index + 1}`));
  const audios: string[] = [];
  for (const [index, input] of (request.audios ?? []).entries()) audios.push(await uploadMedia(context, input, projectId, `toonflow ref audio ${index + 1}`));
  return { first, last, images, videos, audios };
}

function videoRefsAndPrompt(request: ReferencedVideoRequest, cliMode: "t2v" | "m2v" | "first_last_frame", uploaded: Awaited<ReturnType<typeof uploadVideoReferences>>) {
  const lookup: Record<string, string | undefined> = {};
  for (const [index, id] of uploaded.images.entries()) lookup[`image:${index}`] = id;
  for (const [index, id] of uploaded.videos.entries()) lookup[`video:${index}`] = id;
  for (const [index, id] of uploaded.audios.entries()) lookup[`audio:${index}`] = id;
  if (uploaded.first) lookup["firstFrame:0"] = uploaded.first;
  if (uploaded.last) lookup["lastFrame:0"] = uploaded.last;
  const prompt = String(request.prompt ?? "").replace(/\{\{ref (\d+)\}\}/g, (marker, number: string) => {
    const reference = request.referenceOrder?.[Number(number) - 1];
    if (!reference) return marker;
    if (reference.type === "text") return `参考 ${number}`;
    const id = "index" in reference ? lookup[`${reference.type}:${reference.index}`] : lookup[`${reference.type}:0`];
    return id ? `{{res:${id}}}` : marker;
  });
  const refs: string[] = [];
  if (cliMode === "first_last_frame") {
    if (uploaded.first) refs.push(`res:${uploaded.first}`);
    if (uploaded.last) refs.push(`res:${uploaded.last}`);
  } else if (cliMode === "m2v") {
    for (const id of [...uploaded.images, ...uploaded.videos, ...uploaded.audios]) refs.push(`res:${id}`);
  }
  return { prompt, refs };
}

export default {
  id: "dreamina",
  label: "即梦 Dreamina",
  version: "1.0.0",
  readme: `## 即梦 Dreamina（本地 CLI）

通过 [Dreamina Canvas CLI](https://dreamina.capcut.com/canvas-cli/install.ps1) 使用即梦的图片与视频模型，生成与计价使用你自己的即梦账号积分。

### 准备

1. 安装 CLI：Windows PowerShell 执行 \`irm https://dreamina.capcut.com/canvas-cli/install.ps1 | iex\`；
2. 登录：终端执行 \`dreamina-canvas auth login\`，浏览器完成授权；
3. 在本供应商设置里确认「CLI 路径」。Windows 下若 PATH 未生效，请填完整路径（如 \`C:/Users/<用户>/bin/dreamina-canvas.exe\`）。

### 说明

- 估价：改参数时按当前模型与档位显示预计积分（Dreamina 官方报价，不生成、不扣费）；
- 生成：真实扣积分，超过「单次生成积分上限」会自动停止并提示；
- 生成结果同时会保存在 Dreamina 的桥接画布（可在即梦网页端查看与继续编辑）。`,
  rules,
  models: [
    {
      id: "seedream_5.5",
      label: "Seedream 5.5",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:4", "16:9", "4:3", "9:16", "2:3", "3:2", "21:9"],
      imageSizes: ["1.5K", "2K"],
    },
    {
      id: "seedream_5.0_pro",
      label: "Seedream 5.0 Pro",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2", "9:21", "21:9"],
      imageSizes: ["1.5K", "2K", "4K"],
    },
    {
      id: "seedream_4.0",
      label: "Seedream 4.0",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:4", "16:9", "4:3", "9:16", "2:3", "3:2", "21:9"],
      imageSizes: ["2K", "4K"],
    },
    {
      id: "gemini_3_image_pro",
      label: "Nano Banana Pro",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:4", "16:9", "4:3", "9:16", "2:3", "3:2", "21:9"],
      imageSizes: ["1K", "2K", "4K"],
    },
    {
      id: "jm_image_model_gg_bp_21",
      label: "Nano Banana 2.1",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:4", "16:9", "4:3", "9:16", "2:3", "3:2", "21:9"],
      imageSizes: ["1K", "2K", "4K"],
    },
    {
      id: "gpt_image_2_5_flare",
      label: "GPT Image 2.5 Flare",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2", "4:5", "5:4", "9:21", "21:9", "1:3", "3:1"],
      imageSizes: ["1K", "2K", "4K"],
    },
    {
      id: "dreamina_gpt_image_2_5_sunburst",
      label: "GPT Image 2.5 Sunburst",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2", "4:5", "5:4", "9:21", "21:9", "1:3", "3:1"],
      imageSizes: ["1K", "2K", "4K"],
    },
    {
      id: "seedance_2.5",
      label: "Seedance 2.5",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:30", "videoReference:10", "audioReference:10"]],
      durationResolutionMap: [{ duration: [5], resolution: ["480p", "720p", "1080p", "4k"] }],
      imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
    {
      id: "seedance_2.5_flash",
      label: "Seedance 2.5 Flash",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:10", "videoReference:5", "audioReference:5"]],
      durationResolutionMap: [{ duration: [5], resolution: ["480p", "720p"] }],
      imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
    {
      id: "seedance_2.0",
      label: "Seedance 2.0",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      durationResolutionMap: [{ duration: [5], resolution: ["720p", "1080p", "4K"] }],
      imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
    {
      id: "seedance_2.0_fast",
      label: "Seedance 2.0 Fast",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      durationResolutionMap: [{ duration: [5], resolution: ["720p"] }],
      imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
    {
      id: "veo_3.1",
      label: "Veo 3.1",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:3"]],
      durationResolutionMap: [{ duration: [8], resolution: ["720p", "1080p", "4k"] }],
      imageRatios: ["16:9", "9:16"],
    },
    {
      id: "veo_3.1_fast",
      label: "Veo 3.1 Fast",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:3"]],
      durationResolutionMap: [{ duration: [8], resolution: ["720p", "1080p", "4k"] }],
      imageRatios: ["16:9", "9:16"],
    },
    {
      id: "grok_imagine_1.5",
      label: "Grok Imagine 1.5",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:7"]],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["720P", "1080P"] }],
      imageRatios: ["16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
    },
    {
      id: "wan_3.0",
      label: "Wan 3.0",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:10", "videoReference:5", "audioReference:5"]],
      durationResolutionMap: [{ duration: [5], resolution: ["720P", "1080P"] }],
      imageRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
    },
  ] satisfies ProviderModel[],
  async getPrice(request: ProviderPriceRequest): Promise<ProviderPrice | null> {
    if (request.type === "audio") return null;
    const context = this as ProviderContext;
    if (request.type === "image") {
      const imageReferenceCount = request.images?.length ?? 0;
      const quote = await quoteParams(context, "image", {
        prompt: String(request.prompt ?? "quote"),
        model: request.model,
        ratio: request.ratio,
        resolution: request.size,
        count: request.n,
        mode: imageReferenceCount ? "i2i" : "t2i",
        referenceCount: imageReferenceCount,
      });
      return quoteResult(quote);
    }
    const videoReferenceCount = (request.firstFrame ? 1 : 0) + (request.lastFrame ? 1 : 0) + (request.images?.length ?? 0) + (request.videos?.length ?? 0) + (request.audios?.length ?? 0);
    const quote = await quoteParams(context, "video", {
      prompt: String(request.prompt ?? "quote"),
      model: request.model,
      ratio: request.ratio,
      resolution: request.resolution,
      duration: request.duration,
      mode: videoReferenceCount ? resolveVideoMode(request.mode, request as ReferencedVideoRequest) : "t2v",
      referenceCount: videoReferenceCount,
    });
    return quoteResult(quote);
  },
  async getBalance(): Promise<ProviderBalance> {
    const account = await cli<{ availableCredits?: string | number }>(this as ProviderContext, [
      "auth", "account", "--format", "json",
    ]);
    const credits = Number(account.availableCredits);
    if (!Number.isFinite(credits)) throw Object.assign(new Error("Dreamina 余额查询失败：未返回积分"), { code: "MEDIA_TASK_FAILED" });
    return { balance: credits, unit: "积分" };
  },
  async generateImage(request: ReferencedImageRequest): Promise<MediaAsset[]> {
    const context = this as ProviderContext;
    const projectId = await bridge(context);
    const refs: string[] = [];
    const lookup: Record<number, string> = {};
    for (const [index, input] of (request.images ?? []).entries()) {
      lookup[index] = await uploadMedia(context, input, projectId, `toonflow ref image ${index + 1}`);
      refs.push(`res:${lookup[index]}`);
    }
    const prompt = String(request.prompt ?? "").replace(/\{\{ref (\d+)\}\}/g, (marker, number: string) => {
      const reference = request.referenceOrder?.[Number(number) - 1];
      if (!reference) return marker;
      if (reference.type === "text") return `参考 ${number}`;
      const id = "index" in reference ? lookup[reference.index] : undefined;
      return id ? `{{res:${id}}}` : marker;
    });
    return runGeneration(context, "image", {
      prompt,
      model: request.model,
      ratio: request.ratio,
      resolution: request.size,
      count: request.n,
      mode: refs.length ? "i2i" : "t2i",
      refs,
    });
  },
  async generateVideo(request: ReferencedVideoRequest): Promise<MediaAsset[]> {
    const context = this as ProviderContext;
    const projectId = await bridge(context);
    const cliMode = resolveVideoMode(request.mode, request);
    const uploaded = await uploadVideoReferences(context, request, projectId);
    const { prompt, refs } = videoRefsAndPrompt(request, cliMode, uploaded);
    return runGeneration(context, "video", {
      prompt,
      model: request.model,
      ratio: request.ratio,
      resolution: request.resolution,
      duration: request.duration,
      mode: cliMode,
      refs,
    });
  },
  async resumeTask(data: ProviderTaskData): Promise<MediaAsset[]> {
    const context = this as ProviderContext;
    const identity = data as Partial<GenerationIdentity>;
    if (identity.kind !== "image" && identity.kind !== "video") throw Object.assign(new Error("Dreamina 任务恢复数据无效"), { code: "MEDIA_TASK_FAILED" });
    if (typeof identity.projectId !== "string" || typeof identity.submitId !== "string" || !identity.projectId || !identity.submitId) {
      throw Object.assign(new Error("Dreamina 任务恢复数据无效：缺少画布或任务标识"), { code: "MEDIA_TASK_FAILED" });
    }
    return pollAndDownload(context, identity.projectId, identity.submitId, identity.kind);
  },
} satisfies ProviderDefinition<typeof rules>;
