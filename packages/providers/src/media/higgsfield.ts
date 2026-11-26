// Higgsfield 本地 CLI 作为 Toonflow 媒体模型供应商。
// 通过宿主注入的 tool.exec 调用 higgsfield 命令行；凭证由 CLI 自行管理（OAuth 2.0 PKCE）。
// 依赖：已安装 higgsfield（或 hf.exe）并完成 higgsfield auth login 与工作区选择。

const rules = [
  {
    type: "input",
    field: "cliPath" as const,
    title: "CLI 路径",
    value: "higgsfield",
    props: { placeholder: "higgsfield 或 C:/Users/<用户>/bin/higgsfield.exe" },
  },
  {
    type: "inputNumber",
    field: "creditCeiling" as const,
    title: "单次生成积分上限",
    value: 200,
    props: { min: 0, precision: 0, placeholder: "超过该积分报价时停止生成（0 表示不限制）" },
  },
] as const;

const mimeExt: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
  "audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/flac": ".flac",
};

// 按模型声明 CLI 参数差异，避免向不支持对应字段的模型传参触发 Unknown params。
const imageSizeFlag: Record<string, "--resolution" | "--quality" | null> = {
  gpt_image_2_5: "--resolution",
  gpt_image_2: "--resolution",
  nano_banana_2: "--resolution",
  nano_banana_flash: "--resolution",
  nano_banana_2_lite: "--resolution",
  flux_2: "--resolution",
  grok_image: "--resolution",
  cinematic_studio_2_5: "--resolution",
  text2image_soul_v2: "--quality",
  soul_cinematic: "--quality",
  seedream_v4_5: null,
  seedream_v5_lite: null,
  z_image: null,
};

const imageBatchModels = new Set(["cinematic_studio_2_5"]);
const videoModeModels = new Set(["kling3_0"]);
const videoQualityModels = new Set(["wan2_6"]);
const videoSoundOnOffModels = new Set(["kling3_0"]);
const videoSoundBoolModels = new Set(["kling2_6"]);
const videoGenerateAudioModels = new Set(["seedance_2_5", "seedance1_5", "veo3_1_lite", "cinematic_studio_3_0"]);
const videoStartImageOnlyModels = new Set(["kling3_0_turbo", "kling2_6", "veo3_1", "grok_video"]);
const videoFramePairModels = new Set(["kling3_0", "seedance1_5", "veo3_1_lite", "wan2_7"]);

function cfg(context: ProviderContext) {
  const cliPath = String(context.config.cliPath ?? "").trim() || "higgsfield";
  const ceiling = Number(context.config.creditCeiling);
  const creditCeiling = Number.isFinite(ceiling) && ceiling > 0 ? Math.floor(ceiling) : 0;
  return { cliPath, creditCeiling };
}

function parseJsonOutput<T>(stdout: string, stderr: string): T | undefined {
  const candidates = [stdout.trim(), stderr.trim()].filter(Boolean);
  for (const text of candidates) {
    try {
      return JSON.parse(text) as T;
    } catch {
      const start = text.search(/[\[{]/);
      const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
      if (start >= 0 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)) as T; } catch { /* ignore */ }
      }
    }
  }
  return undefined;
}

function authErrorMessage(raw: string, cliPath: string): string | undefined {
  if (/not authenticated|session expired|unauthorized|login required/i.test(raw)) {
    return `Higgsfield 需要登录：请在终端运行 ${cliPath} auth login 完成授权后重试`;
  }
  if (/no workspace selected/i.test(raw)) {
    return `Higgsfield 尚未选择工作区：请先运行 ${cliPath} auth login 或 ${cliPath} workspace set <workspace_id>`;
  }
  return undefined;
}

async function cli<T>(context: ProviderContext, args: string[], options?: {
  inputFiles?: { data: Uint8Array; name: string }[];
  timeoutMs?: number;
}): Promise<T> {
  const { cliPath } = cfg(context);
  const finalArgs = args.includes("--json") ? [...args, "--no-color"] : [...args, "--json", "--no-color"];
  const result = await context.tool.exec({
    executable: cliPath,
    args: finalArgs,
    inputFiles: options?.inputFiles,
    timeoutMs: options?.timeoutMs ?? 120_000,
  });
  const combined = `${result.stderr}\n${result.stdout}`.trim();
  if (result.exitCode !== 0) {
    const authHint = authErrorMessage(combined, cliPath);
    if (authHint) throw Object.assign(new Error(authHint), { code: "MEDIA_TASK_FAILED" });
    const parsedErr = parseJsonOutput<{ error?: string; message?: string; error_description?: string }>(result.stdout, result.stderr);
    const detail = parsedErr?.error_description || parsedErr?.message || parsedErr?.error || combined.slice(0, 300) || `exit ${result.exitCode}`;
    throw Object.assign(new Error(`Higgsfield：${detail}`), { code: "MEDIA_TASK_FAILED" });
  }
  const parsed = parseJsonOutput<T>(result.stdout, result.stderr);
  if (parsed === undefined) {
    throw Object.assign(new Error(`Higgsfield CLI 输出无法解析：${(combined || "无输出").slice(0, 300)}`), { code: "MEDIA_TASK_FAILED" });
  }
  return parsed;
}

function wait(context: ProviderContext, ms: number) {
  context.signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { context.signal?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(context.signal!.reason); };
    context.signal?.addEventListener("abort", abort, { once: true });
  });
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

function fileNameFor(prefix: string, index: number, mimeType: string, originalName?: string) {
  const ext = mimeExt[mimeType.toLowerCase()] ?? (/\.[a-z0-9]{2,4}$/i.exec(originalName ?? "") ?? [".bin"])[0].toLowerCase();
  return `${prefix}-${index}${ext}`;
}

function cleanPrompt(prompt: unknown): string {
  return String(prompt ?? "").replace(/\{\{ref (\d+)\}\}/g, "reference $1").trim();
}

function normalizeResolution(value?: string): string | undefined {
  if (!value) return undefined;
  return value.trim().toLowerCase();
}

function extractNumber(value: unknown, keys: string[]): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (key in record) {
      const found = extractNumber(record[key], keys);
      if (found !== undefined) return found;
    }
  }
  for (const nestedKey of ["account", "workspace", "data", "result"]) {
    if (nestedKey in record) {
      const found = extractNumber(record[nestedKey], keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function extractJobId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["job_id", "id", "job_set_id"]) {
    const val = record[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  if (Array.isArray(record.jobs)) {
    for (const job of record.jobs) {
      const id = extractJobId(job);
      if (id) return id;
    }
  }
  for (const nestedKey of ["job", "data", "result"]) {
    const id = extractJobId(record[nestedKey]);
    if (id) return id;
  }
  return undefined;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function collectUrls(payload: unknown, primary: Set<string>, fallback: Set<string>) {
  if (!payload || typeof payload !== "object") return;
  if (Array.isArray(payload)) {
    for (const item of payload) collectUrls(item, primary, fallback);
    return;
  }
  const record = payload as Record<string, unknown>;
  const rawObj = record.raw;
  if (rawObj && typeof rawObj === "object" && isHttpUrl((rawObj as Record<string, unknown>).url)) {
    primary.add(String((rawObj as Record<string, unknown>).url).trim());
  }
  for (const key of ["result_url", "output_url", "url"]) {
    if (isHttpUrl(record[key])) primary.add(String(record[key]).trim());
  }
  for (const key of ["urls", "image_urls"]) {
    if (Array.isArray(record[key])) {
      for (const item of record[key] as unknown[]) {
        if (isHttpUrl(item)) primary.add(item.trim());
      }
    }
  }
  for (const key of ["min_result_url", "min_url", "preview_url", "preview"]) {
    if (isHttpUrl(record[key])) fallback.add(String(record[key]).trim());
  }
  for (const nestedKey of ["results", "result", "jobs", "outputs", "data"]) {
    if (nestedKey in record && record[nestedKey] && typeof record[nestedKey] === "object") {
      collectUrls(record[nestedKey], primary, fallback);
    }
  }
}

function extractStatus(payload: unknown): { state: string; errorMessage?: string } {
  if (!payload || typeof payload !== "object") return { state: "" };
  const record = payload as Record<string, unknown>;
  const direct = record.status ?? record.job_status;
  const err = record.error_description ?? record.error ?? record.message;
  if (typeof direct === "string" && direct.trim()) {
    return { state: direct.trim().toLowerCase(), errorMessage: typeof err === "string" ? err : undefined };
  }
  if (Array.isArray(record.jobs) && record.jobs.length > 0) {
    const states = record.jobs.map(job => extractStatus(job));
    if (states.some(item => ["failed", "error", "nsfw", "ip_detected", "canceled", "cancelled"].includes(item.state))) {
      const failed = states.find(item => ["failed", "error", "nsfw", "ip_detected", "canceled", "cancelled"].includes(item.state))!;
      return failed;
    }
    if (states.every(item => ["completed", "succeeded", "success"].includes(item.state))) {
      return { state: "completed" };
    }
    return { state: states[0]?.state ?? "" };
  }
  for (const nestedKey of ["job", "data", "result"]) {
    if (nestedKey in record && record[nestedKey] && typeof record[nestedKey] === "object") {
      const nested = extractStatus(record[nestedKey]);
      if (nested.state) return nested;
    }
  }
  return { state: "" };
}

const quoteCache = new Map<string, { expires: number; value: Promise<number | null> }>();

async function estimateCost(context: ProviderContext, args: string[]): Promise<number | null> {
  const { cliPath } = cfg(context);
  const key = JSON.stringify([cliPath, ...args]);
  const now = Date.now();
  for (const [k, v] of quoteCache) if (v.expires <= now) quoteCache.delete(k);
  const cached = quoteCache.get(key);
  if (cached) return cached.value;
  const promise = cli<unknown>(context, ["generate", "cost", ...args], { timeoutMs: 30_000 })
    .then(data => {
      const cost = extractNumber(data, ["cost", "credits_exact", "credits", "total_cost", "estimated_credits"]);
      return cost ?? null;
    })
    .catch(() => null);
  const entry = { expires: now + 10 * 60_000, value: promise };
  quoteCache.set(key, entry);
  promise.then(value => { if (value === null && quoteCache.get(key) === entry) quoteCache.delete(key); });
  return promise;
}

function buildImageArgs(request: {
  model: string;
  prompt: string;
  ratio?: string;
  size?: string;
  quality?: string;
  n?: number;
  imageFileTokens?: string[];
}): string[] {
  const args: string[] = [request.model];
  const prompt = cleanPrompt(request.prompt);
  if (prompt) args.push("--prompt", prompt);
  if (request.ratio) args.push("--aspect_ratio", request.ratio);
  const sizeFlag = imageSizeFlag[request.model];
  const res = normalizeResolution(request.size);
  if (sizeFlag && res) args.push(sizeFlag, res);
  if (request.quality && sizeFlag !== "--quality") args.push("--quality", request.quality.toLowerCase());
  if (request.n && request.n > 1 && imageBatchModels.has(request.model)) args.push("--batch_size", String(request.n));
  for (const token of request.imageFileTokens ?? []) args.push("--image-references", token);
  return args;
}

function buildVideoArgs(request: {
  model: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  startImageToken?: string;
  endImageToken?: string;
  imageTokens?: string[];
  videoTokens?: string[];
  audioTokens?: string[];
}): string[] {
  const args: string[] = [request.model];
  const prompt = cleanPrompt(request.prompt);
  if (prompt) args.push("--prompt", prompt);
  if (request.ratio) args.push("--aspect_ratio", request.ratio);
  if (request.duration) args.push("--duration", String(request.duration));

  const res = normalizeResolution(request.resolution);
  if (res) {
    if (videoModeModels.has(request.model)) args.push("--mode", res);
    else if (videoQualityModels.has(request.model)) args.push("--quality", res);
    else args.push("--resolution", res);
  }

  if (typeof request.generateAudio === "boolean") {
    if (videoGenerateAudioModels.has(request.model)) {
      args.push("--generate_audio", String(request.generateAudio));
    } else if (videoSoundOnOffModels.has(request.model)) {
      args.push("--sound", request.generateAudio ? "on" : "off");
    } else if (videoSoundBoolModels.has(request.model)) {
      args.push("--sound", String(request.generateAudio));
    }
  }

  const hasAnyMedia = Boolean(
    request.startImageToken || request.endImageToken ||
    request.imageTokens?.length || request.videoTokens?.length || request.audioTokens?.length,
  );
  if (request.model === "seedance_2_5") {
    args.push("--mode", hasAnyMedia ? "omni_reference" : "t2v");
  }

  if (videoStartImageOnlyModels.has(request.model)) {
    const first = request.startImageToken ?? request.imageTokens?.[0];
    if (first) args.push("--start-image", first);
  } else if (videoFramePairModels.has(request.model)) {
    const first = request.startImageToken ?? request.imageTokens?.[0];
    const last = request.endImageToken ?? (request.startImageToken ? undefined : request.imageTokens?.[1]);
    if (first) args.push("--start-image", first);
    if (last) args.push("--end-image", last);
    if (request.model === "wan2_7" && request.audioTokens?.[0]) {
      args.push("--audio-references", request.audioTokens[0]);
    }
  } else {
    if (request.startImageToken) args.push("--start-image", request.startImageToken);
    if (request.endImageToken) args.push("--end-image", request.endImageToken);
    for (const token of request.imageTokens ?? []) args.push("--image-references", token);
    for (const token of request.videoTokens ?? []) args.push("--video-references", token);
    for (const token of request.audioTokens ?? []) args.push("--audio-references", token);
  }
  return args;
}

async function enforceCreditCeiling(context: ProviderContext, args: string[], inputFiles?: { data: Uint8Array; name: string }[]) {
  const { creditCeiling } = cfg(context);
  if (creditCeiling <= 0) return;
  try {
    const data = await cli<unknown>(context, ["generate", "cost", ...args], { inputFiles, timeoutMs: 60_000 });
    const cost = extractNumber(data, ["cost", "credits_exact", "credits", "total_cost", "estimated_credits"]);
    if (cost !== undefined && cost > creditCeiling) {
      throw Object.assign(
        new Error(`Higgsfield 预计消耗 ${cost} 积分，超过设定的单次上限（${creditCeiling} 积分），已停止生成`),
        { code: "MEDIA_TASK_FAILED" },
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("超过设定的单次上限")) throw error;
    // 部分模型或参数组合估价接口可能暂不支持，不阻断实际生成。
  }
}

async function pollJob(context: ProviderContext, jobId: string, mediaType: "image" | "video"): Promise<MediaAsset[]> {
  const deadline = Date.now() + 60 * 60_000;
  let transientFailures = 0;
  while (true) {
    context.signal?.throwIfAborted();
    if (Date.now() > deadline) throw Object.assign(new Error("Higgsfield 生成超时（60 分钟）"), { code: "MEDIA_TASK_FAILED" });
    let payload: unknown;
    try {
      payload = await cli<unknown>(context, ["generate", "get", jobId], { timeoutMs: 60_000 });
      transientFailures = 0;
    } catch (error) {
      if (++transientFailures > 6) throw error;
      await wait(context, 10_000);
      continue;
    }
    const { state, errorMessage } = extractStatus(payload);
    if (state === "completed" || state === "succeeded" || state === "success") {
      const primary = new Set<string>();
      const fallback = new Set<string>();
      collectUrls(payload, primary, fallback);
      const urls = primary.size ? [...primary] : [...fallback];
      if (!urls.length) throw Object.assign(new Error("Higgsfield 任务已完成但未返回结果链接"), { code: "MEDIA_TASK_FAILED" });
      return urls.map(url => ({ mediaType, type: "url", url }));
    }
    if (["failed", "error", "nsfw", "ip_detected", "canceled", "cancelled"].includes(state)) {
      throw Object.assign(
        new Error(`Higgsfield 生成失败（${state}）${errorMessage ? `：${errorMessage}` : ""}`),
        { code: "MEDIA_TASK_FAILED" },
      );
    }
    await wait(context, 5_000);
  }
}

export default {
  id: "higgsfield",
  label: "Higgsfield",
  version: "1.0.0",
  readme: `## Higgsfield（本地 CLI）

通过 [Higgsfield CLI](https://github.com/higgsfield-ai/cli) 调用 Higgsfield 平台的图片与视频模型，生成与计价使用你自己的 Higgsfield 账号积分。

### 准备

1. 安装 CLI：从 [Releases](https://github.com/higgsfield-ai/cli/releases) 下载 Windows 二进制放到 \`C:/Users/<用户>/bin/higgsfield.exe\`（或 \`npm install -g @higgsfield/cli\`）；
2. 登录：终端执行 \`higgsfield auth login\`，在浏览器完成授权；
3. 如账号有多个工作区，可执行 \`higgsfield workspace list\` 与 \`higgsfield workspace set <workspace_id>\`；
4. 在本供应商设置里确认「CLI 路径」（Windows 下若 PATH 未生效，请填完整路径如 \`C:/Users/<用户>/bin/higgsfield.exe\`）。

### 说明

- 估价：改参数时通过 \`higgsfield generate cost\` 显示预计积分（不生成、不扣费）；
- 生成：CLI 调用按积分计费（不走网页端 Unlimited），超过「单次生成积分上限」会自动停止；
- 参考素材由宿主临时文件传给 CLI 自动上传，无需手动配置云存储或 API Key。`,
  rules,
  models: [
    // ── 图片模型 ──
    {
      id: "gpt_image_2_5",
      label: "GPT Image 2.5",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "4:5", "5:4"],
      imageSizes: ["1K", "2K", "4K"],
    },
    {
      id: "gpt_image_2",
      label: "GPT Image 2",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "21:9", "9:16", "3:2", "2:3", "4:5", "5:4"],
      imageSizes: ["1K", "2K", "4K"],
    },
    {
      id: "nano_banana_2",
      label: "Nano Banana Pro",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"],
      imageSizes: ["1K", "2K", "4K"],
    },
    {
      id: "nano_banana_flash",
      label: "Nano Banana 2",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"],
      imageSizes: ["1K", "2K", "4K"],
    },
    {
      id: "nano_banana_2_lite",
      label: "Nano Banana 2 Lite",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"],
      imageSizes: ["1K"],
    },
    {
      id: "seedream_v4_5",
      label: "Seedream 4.5",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "4:3", "16:9", "3:2", "21:9", "3:4", "9:16", "2:3"],
    },
    {
      id: "seedream_v5_lite",
      label: "Seedream V5 Lite",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    },
    {
      id: "flux_2",
      label: "FLUX.2",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
      imageSizes: ["1K", "2K"],
    },
    {
      id: "grok_image",
      label: "Grok Image",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
      imageSizes: ["1K", "2K"],
    },
    {
      id: "cinematic_studio_2_5",
      label: "Cinematic Studio 2.5",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"],
      imageSizes: ["1K", "2K", "4K"],
    },
    {
      id: "text2image_soul_v2",
      label: "Higgsfield Soul V2",
      type: "image",
      mode: ["text", "singleImage"],
      imageRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
      imageSizes: ["1.5K", "2K"],
    },
    {
      id: "soul_cinematic",
      label: "Soul Cinematic",
      type: "image",
      mode: ["text", "singleImage"],
      imageRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
      imageSizes: ["1.5K", "2K"],
    },
    {
      id: "z_image",
      label: "Z Image",
      type: "image",
      mode: ["text"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    },
    // ── 视频模型 ──
    {
      id: "seedance_2_5",
      label: "Seedance 2.5",
      type: "video",
      audio: "optional",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:12", "videoReference:3", "audioReference:3"]],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25, 30], resolution: ["480p", "720p", "1080p"] }],
      imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
    {
      id: "seedance_2_0",
      label: "Seedance 2.0",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p", "1080p", "4k"] }],
      imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
    {
      id: "seedance_2_0_mini",
      label: "Seedance 2.0 Mini",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }],
      imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
    {
      id: "seedance1_5",
      label: "Seedance 1.5 Pro",
      type: "video",
      audio: "optional",
      mode: ["text", "startEndRequired", "endFrameOptional"],
      durationResolutionMap: [{ duration: [4, 8, 12], resolution: ["480p", "720p", "1080p"] }],
      imageRatios: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
    },
    {
      id: "kling3_0",
      label: "Kling v3.0",
      type: "video",
      audio: "optional",
      mode: ["text", "startEndRequired", "endFrameOptional"],
      durationResolutionMap: [{ duration: [5, 10], resolution: ["std", "pro", "4k"] }],
      imageRatios: ["16:9", "9:16", "1:1"],
    },
    {
      id: "kling3_0_turbo",
      label: "Kling 3.0 Turbo",
      type: "video",
      mode: ["text", "singleImage", "startFrameOptional"],
      durationResolutionMap: [{ duration: [5, 10], resolution: ["720p", "1080p"] }],
      imageRatios: ["16:9", "9:16", "1:1"],
    },
    {
      id: "kling2_6",
      label: "Kling 2.6 Video",
      type: "video",
      audio: "optional",
      mode: ["text", "singleImage", "startFrameOptional"],
      durationResolutionMap: [{ duration: [5, 10], resolution: ["720p"] }],
      imageRatios: ["16:9", "9:16", "1:1"],
    },
    {
      id: "veo3_1",
      label: "Google Veo 3.1",
      type: "video",
      mode: ["text", "singleImage", "startFrameOptional"],
      durationResolutionMap: [{ duration: [4, 6, 8], resolution: ["720p"] }],
      imageRatios: ["16:9", "9:16"],
    },
    {
      id: "veo3_1_lite",
      label: "Google Veo 3.1 Lite",
      type: "video",
      audio: "optional",
      mode: ["text", "startEndRequired", "endFrameOptional"],
      durationResolutionMap: [{ duration: [4, 6, 8], resolution: ["720p"] }],
      imageRatios: ["16:9", "9:16"],
    },
    {
      id: "gemini_omni",
      label: "Gemini Omni Flash",
      type: "video",
      mode: ["text", ["imageReference:7", "videoReference:1"]],
      durationResolutionMap: [{ duration: [4, 6, 8, 10], resolution: ["720p"] }],
      imageRatios: ["16:9", "9:16"],
    },
    {
      id: "wan2_7",
      label: "Wan 2.7",
      type: "video",
      mode: ["text", "startEndRequired", "endFrameOptional"],
      durationResolutionMap: [{ duration: [5, 10], resolution: ["720p", "1080p"] }],
      imageRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    },
    {
      id: "wan2_6",
      label: "Wan 2.6 Video",
      type: "video",
      mode: ["text", ["imageReference:4", "videoReference:1", "audioReference:1"]],
      durationResolutionMap: [{ duration: [5, 10, 15], resolution: ["720p", "1080p"] }],
      imageRatios: ["16:9", "9:16", "1:1"],
    },
    {
      id: "grok_video",
      label: "Grok Video",
      type: "video",
      mode: ["text", "singleImage", "startFrameOptional"],
      durationResolutionMap: [{ duration: [5, 10], resolution: ["720p"] }],
      imageRatios: ["16:9", "9:16", "1:1"],
    },
    {
      id: "cinematic_studio_3_0",
      label: "Cinematic Studio 3.0",
      type: "video",
      audio: "optional",
      mode: ["text", "startEndRequired", "endFrameOptional", ["imageReference:10", "videoReference:3", "audioReference:3"]],
      durationResolutionMap: [{ duration: [5, 10, 15], resolution: ["480p", "720p", "1080p", "4k"] }],
      imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
  ] satisfies ProviderModel[],
  async getPrice(request: ProviderPriceRequest): Promise<ProviderPrice | null> {
    if (request.type === "audio") return null;
    const context = this as ProviderContext;
    const args = request.type === "image"
      ? buildImageArgs({
          model: request.model,
          prompt: "quote",
          ratio: request.ratio,
          size: request.size,
          n: request.n,
        })
      : buildVideoArgs({
          model: request.model,
          prompt: "quote",
          ratio: request.ratio,
          resolution: request.resolution,
          duration: request.duration,
          generateAudio: request.generateAudio,
        });
    const credits = await estimateCost(context, args);
    if (credits === null) return null;
    return { price: `≈${credits} 积分`, tips: "Higgsfield CLI 官方报价（不扣费）；实际扣费以账号记录为准" };
  },
  async getBalance(): Promise<ProviderBalance> {
    const data = await cli<unknown>(this as ProviderContext, ["account", "status"]);
    const credits = extractNumber(data, ["credits_exact", "credits", "available_credits", "balance"]);
    if (credits === undefined) throw Object.assign(new Error("Higgsfield 余额查询失败：未返回积分"), { code: "MEDIA_TASK_FAILED" });
    return { balance: credits, unit: "积分" };
  },
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const context = this as ProviderContext;
    const inputFiles: { data: Uint8Array; name: string }[] = [];
    const imageFileTokens: string[] = [];
    for (const [index, input] of (request.images ?? []).entries()) {
      const media = await bytesOf(context, input);
      const tokenIndex = inputFiles.length;
      inputFiles.push({ data: media.data, name: fileNameFor("ref-img", index, media.mimeType, media.name) });
      imageFileTokens.push(`{{file:${tokenIndex}}}`);
    }
    const args = buildImageArgs({
      model: request.model,
      prompt: request.prompt,
      ratio: request.ratio,
      size: request.size,
      quality: request.quality,
      n: request.n,
      imageFileTokens,
    });
    await enforceCreditCeiling(context, args, inputFiles.length ? inputFiles : undefined);
    const created = await cli<unknown>(context, ["generate", "create", ...args], {
      inputFiles: inputFiles.length ? inputFiles : undefined,
      timeoutMs: 300_000,
    });
    const jobId = extractJobId(created);
    if (!jobId) throw Object.assign(new Error("Higgsfield 任务创建失败：未返回 job_id"), { code: "MEDIA_TASK_FAILED" });
    await context.saveTaskData?.({ kind: "image", jobId } satisfies ProviderTaskData);
    return pollJob(context, jobId, "image");
  },
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const context = this as ProviderContext;
    const inputFiles: { data: Uint8Array; name: string }[] = [];
    const attach = async (prefix: string, index: number, input: MediaInput) => {
      const media = await bytesOf(context, input);
      const tokenIndex = inputFiles.length;
      inputFiles.push({ data: media.data, name: fileNameFor(prefix, index, media.mimeType, media.name) });
      return `{{file:${tokenIndex}}}`;
    };
    const startImageToken = request.firstFrame ? await attach("start", 0, request.firstFrame) : undefined;
    const endImageToken = request.lastFrame ? await attach("end", 0, request.lastFrame) : undefined;
    const imageTokens: string[] = [];
    for (const [index, input] of (request.images ?? []).entries()) imageTokens.push(await attach("ref-img", index, input));
    const videoTokens: string[] = [];
    for (const [index, input] of (request.videos ?? []).entries()) videoTokens.push(await attach("ref-vid", index, input));
    const audioTokens: string[] = [];
    for (const [index, input] of (request.audios ?? []).entries()) audioTokens.push(await attach("ref-aud", index, input));

    const args = buildVideoArgs({
      model: request.model,
      prompt: request.prompt,
      ratio: request.ratio,
      resolution: request.resolution,
      duration: request.duration,
      generateAudio: request.generateAudio,
      startImageToken,
      endImageToken,
      imageTokens,
      videoTokens,
      audioTokens,
    });
    await enforceCreditCeiling(context, args, inputFiles.length ? inputFiles : undefined);
    const created = await cli<unknown>(context, ["generate", "create", ...args], {
      inputFiles: inputFiles.length ? inputFiles : undefined,
      timeoutMs: 300_000,
    });
    const jobId = extractJobId(created);
    if (!jobId) throw Object.assign(new Error("Higgsfield 任务创建失败：未返回 job_id"), { code: "MEDIA_TASK_FAILED" });
    await context.saveTaskData?.({ kind: "video", jobId } satisfies ProviderTaskData);
    return pollJob(context, jobId, "video");
  },
  async resumeTask(data: ProviderTaskData): Promise<MediaAsset[]> {
    const context = this as ProviderContext;
    const kind = data.kind;
    const jobId = data.jobId;
    if ((kind !== "image" && kind !== "video") || typeof jobId !== "string" || !jobId.trim()) {
      throw Object.assign(new Error("Higgsfield 任务恢复数据无效"), { code: "MEDIA_TASK_FAILED" });
    }
    return pollJob(context, jobId.trim(), kind);
  },
} satisfies ProviderDefinition<typeof rules>;
