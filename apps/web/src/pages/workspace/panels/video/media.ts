// 剪辑面板的媒体与 FFmpeg 入口：工作区文件的预览地址、探测、波形、胶片条、静帧、录音转换、单帧与导出。
// FFmpeg 通过宿主的浏览器桥执行，所有路径均为当前工作区内的相对路径。

import axios from "axios";
import { createBrowserFfmpeg, type BrowserFfmpegCommand, type BrowserFfmpegFactory, type FfprobeData } from "@toonflow/ffmpeg/browser";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { measureText, textPng } from "./captions";
import { maskPng } from "./masks";
import { exportPlan, type AssetFiles, type PlanOptions } from "./exportPlan";
import type { VideoClip, VideoDoc, VideoStrip } from "./types";
import { fileName, imageSeconds, isVisual, mediaKind, needsMask, uid } from "./timeline";

export interface Probe { duration: number | null; width: number | null; height: number | null; video: boolean; audio: boolean }
export type Media = ReturnType<typeof createMedia>;

const primed = new WeakSet<HTMLMediaElement>();
// ACT: 渲染全程串行，防止单帧与导出覆盖共用的滤镜图和 PNG；不同工作区也共用此队列。
let renderQueue: Promise<unknown> = Promise.resolve();

function queueRender<T>(action: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(action);
  renderQueue = result.catch(() => {});
  return result;
}

/** 让媒体元素跟随片段时间：偏差过大时跳转，并随时间线播放或暂停。`gain` 为 null 时不改音量。 */
export function syncElement(element: HTMLMediaElement, clip: VideoClip, place: { start: number; end: number }, time: number, playing: boolean, fps: number, gain: number | null, rate = 1) {
  const speed = clip.speed ?? 1;
  // 浏览器最多支持 16 倍速。
  element.playbackRate = Math.min(16, speed * Math.max(rate, 0.0625));
  const active = time >= place.start && time < place.end;
  if (gain !== null) {
    element.volume = Math.min(1, gain);
    element.muted = gain <= 0;
  }
  if (!active) {
    if (!element.paused) element.pause();
    // 等待开始时停在首帧，切换时无需等待加载。
    if (time < place.start && !primed.has(element)) {
      element.currentTime = clip.in;
      primed.add(element);
    }
    return;
  }
  primed.delete(element);
  const local = clip.in + (time - place.start) * speed;
  if (playing) {
    if (element.paused) {
      if (Math.abs(element.currentTime - local) > 0.05) element.currentTime = local;
      element.play().catch(() => {});
    } else if (Math.abs(element.currentTime - local) > 0.3) element.currentTime = local;
  } else {
    if (!element.paused) element.pause();
    if (Math.abs(element.currentTime - local) > 0.5 / fps) element.currentTime = local;
  }
}

/** 剪辑面板生成的文件位置。 */
export const videoFolders = { exports: "exports", assets: "assets/videoEditor", work: ".toonflowVideo" };
const peakRate = 50;
/** 路径的短哈希，用于缓存文件名：同一文件重复生成时覆盖旧缓存。 */
const pathKey = (path: string) => { let hash = 2166136261; for (const char of path) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(36); };
const stripHeight = 90;
/** 预览地址在没有片段使用后仍保留的文件数，来回拖动播放头时无需重新读取；更早的释放内存。 */
const idleUrls = 6;

/** 同时最多运行 `slots` 个任务，其余排队。 */
function limiter(slots: number) {
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (slots > 0) slots--;
    else await new Promise<void>(resolve => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else slots++;
    }
  };
}

function isExists(error: unknown) {
  return axios.isAxiosError<{ data?: { code?: string } }>(error) && (error.response?.status === 409 || error.response?.data?.data?.code === "EEXIST");
}

/** 当前工作区的媒体服务；目录在创建时固定，面板卸载时调用 `dispose` 释放预览地址。 */
export function createMedia(directory: string) {
  const files = useWorkspaceFiles(directory);
  const lifetime = new AbortController();
  let factory: Promise<BrowserFfmpegFactory> | undefined;
  /** 按最近使用排序（最后一项最新）。 */
  const urls = new Map<string, { entry: ReturnType<ReturnType<typeof useWorkspaceFiles>["acquireUrl"]>; users: number }>();
  const probes = new Map<string, Promise<Probe>>();
  const peaks = new Map<string, Promise<{ rate: number; peaks: Uint8Array } | null>>();
  const strips = new Map<string, Promise<VideoStrip | null>>();
  const thumbs = new Map<string, Promise<string | null>>();
  // 素材多时不能一次启动几十个 FFmpeg：探测较轻，胶片条、波形与缩略图共用较少的名额。
  const probeLimit = limiter(4);
  const workLimit = limiter(2);
  const madeDirectories = new Set<string>();
  const stripUrls: string[] = [];

  function ffmpeg() {
    lifetime.signal.throwIfAborted();
    factory ??= createBrowserFfmpeg(directory).catch(error => {
      factory = undefined;
      throw error;
    });
    return factory;
  }

  /** 逐级创建目录，已存在时忽略。 */
  async function ensureDirectory(path: string) {
    const parts = path.split("/").filter(Boolean);
    for (let index = 1; index <= parts.length; index++) {
      const folder = parts.slice(0, index).join("/");
      if (madeDirectories.has(folder)) continue;
      await files.mkdir(folder).catch(error => { if (!isExists(error)) throw error; });
      madeDirectories.add(folder);
    }
  }

  /** 新建文件，重名时追加序号；返回实际路径。 */
  async function writeNew(folder: string, name: string, content: Blob | ArrayBuffer | string) {
    await ensureDirectory(folder);
    const dot = name.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let index = 0; index < 1000; index++) {
      const path = `${folder}/${index ? `${stem} (${index})` : stem}${extension}`;
      try {
        await files.write(path, content, true);
        return path;
      } catch (error) {
        if (!isExists(error)) throw error;
      }
    }
    throw new Error("同名文件过多，请清理后重试");
  }

  /** 独占创建空输出，FFmpeg 仅覆盖本次操作已取得的文件；失败时保留，不自动删除。 */
  const freePath = (folder: string, name: string) => writeNew(folder, name, "");

  /** 释放超出 `idleUrls` 个、已无人使用的最旧预览地址。 */
  function trimUrls() {
    let idle = 0;
    for (const held of urls.values()) if (!held.users) idle++;
    for (const [path, held] of urls) {
      if (idle <= idleUrls) break;
      if (held.users) continue;
      urls.delete(path);
      held.entry.release();
      idle--;
    }
  }

  /**
   * 预览地址：使用者在离开（片段移出播放窗口、源监视器换文件）时调用 `release`。最近不再使用的几个文件仍保留，
   * 其余释放，避免时间线上视频多时所有文件都留在内存里。
   * ACT: 媒体整体读入内存生成 Blob 地址，同时使用的文件总量即内存上限；需要时可改为支持 Range 的带令牌地址。
   */
  function acquire(path: string) {
    let held = urls.get(path);
    if (held) urls.delete(path);
    else {
      const entry = files.acquireUrl(path);
      const created = { entry, users: 0 };
      held = created;
      void entry.url.catch(() => {
        if (urls.get(path) !== created) return;
        urls.delete(path);
        entry.release();
      });
    }
    urls.set(path, held);
    held.users++;
    const current = held;
    let released = false;
    return {
      url: current.entry.url,
      release() {
        if (released) return;
        released = true;
        if (--current.users) return;
        // 刚释放的排到最新，最后才被清理。
        if (urls.get(path) === current) {
          urls.delete(path);
          urls.set(path, current);
        }
        trimUrls();
      },
    };
  }

  /** 保留到面板关闭的预览地址（导出结果等少量文件）。 */
  const url = (path: string) => acquire(path).url;

  /** 运行一条命令直到结束；`onProgress` 收到已处理的秒数。 */
  function run(command: BrowserFfmpegCommand, output: string, signal?: AbortSignal, onProgress?: (seconds: number) => void) {
    signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const abort = () => command.kill();
      signal?.addEventListener("abort", abort, { once: true });
      const finish = (error?: unknown) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(signal.reason);
        else if (error) reject(error);
        else resolve();
      };
      command.on("progress", progress => {
        const match = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(progress.timemark ?? "");
        if (match) onProgress?.(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
      });
      command.on("error", (error, _stdout, stderr) => {
        const lines = (stderr ?? "").trim().split(/\r?\n/).filter(line => line && !/^\s*(Stream|Input|Output|Duration|Metadata|encoder|major_brand|minor_version|compatible_brands|creation_time|handler_name|vendor_id|Side data|configuration|built with|lib)/.test(line));
        finish(lines.length ? new Error(lines.slice(-4).join("\n")) : error);
      });
      command.on("end", () => finish());
      try {
        command.save(output);
      } catch (error) {
        finish(error);
      }
    });
  }

  /** 文件时长、像素尺寸与流信息；按路径缓存。 */
  function probe(path: string) {
    let job = probes.get(path);
    if (!job) {
      job = probeLimit(() => ffmpeg().then(factory => new Promise<Probe>((resolve, reject) => {
        factory.ffprobe(path, (error: unknown, data: FfprobeData) => {
          if (error) return reject(error);
          const video = data.streams.find(stream => stream.codec_type === "video");
          const audio = data.streams.some(stream => stream.codec_type === "audio");
          if (!video && !audio) return reject(new Error(`不是视频、图片或音频文件：${path}`));
          const rotation = Number(video?.tags?.rotate ?? (video?.side_data_list as { rotation?: number }[] | undefined)?.find(item => item.rotation !== undefined)?.rotation ?? 0);
          const turned = Math.abs(Math.abs(rotation) % 180 - 90) < 1;
          const [width, height] = video?.width && video.height ? [video.width, video.height] : [null, null];
          const duration = Number(data.format.duration);
          resolve({ duration: Number.isFinite(duration) && duration > 0 ? duration : null, width: turned ? height : width, height: turned ? width : height, video: !!video, audio });
        });
      })));
      probes.set(path, job);
      void job.catch(() => probes.delete(path));
    }
    return job;
  }

  /** 文件对应的整段片段；不是图片、视频或音频时返回 null。 */
  async function clipFor(path: string, track: string): Promise<VideoClip | null> {
    const kind = mediaKind(path);
    if (!kind) return null;
    const name = fileName(path);
    const info = await probe(path);
    const size = kind !== "audio" && info.width && info.height ? { width: info.width, height: info.height } : {};
    if (kind === "image") return { id: uid(), track, kind, src: path, name, in: 0, out: imageSeconds, ...size };
    if (!info.duration) throw new Error(`无法读取 ${name} 的时长`);
    return { id: uid(), track, kind, src: path, name, in: 0, out: info.duration, srcDuration: info.duration, ...size };
  }

  /** 文件响度（每秒 `peakRate` 个 0–255 峰值），用于片段波形；无声音时为 null。 */
  function peaksOf(path: string) {
    let job = peaks.get(path);
    if (!job) {
      job = (async () => {
        const info = await probe(path);
        if (!info.audio) return null;
        const sampleRate = 2000;
        const output = `${videoFolders.work}/cache/peaks-${pathKey(path)}.pcm`;
        await ensureDirectory(`${videoFolders.work}/cache`);
        const factory = await ffmpeg();
        await workLimit(() => run(factory(path).noVideo().audioChannels(1).audioFrequency(sampleRate).format("s16le"), output));
        const view = new DataView(await files.read(output));
        const perPeak = sampleRate / peakRate;
        const values: number[] = [];
        let peak = 0;
        let count = 0;
        for (let offset = 0; offset + 1 < view.byteLength; offset += 2) {
          peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
          if (++count === perPeak) {
            values.push(Math.min(255, Math.round((peak / 32768) * 255)));
            peak = 0;
            count = 0;
          }
        }
        if (count) values.push(Math.min(255, Math.round((peak / 32768) * 255)));
        return values.length ? { rate: peakRate, peaks: Uint8Array.from(values) } : null;
      })().catch(() => null);
      peaks.set(path, job);
    }
    return job;
  }

  /** 视频均匀抽帧并横向拼成一张 JPEG（最多 120 帧），用于片段胶片条。 */
  function stripOf(path: string) {
    let job = strips.get(path);
    if (!job) {
      job = (async () => {
        const info = await probe(path);
        if (!info.video || !info.duration || !info.width || !info.height) return null;
        const count = Math.min(120, Math.max(8, Math.ceil(info.duration / 2)));
        const width = Math.max(2, Math.round((stripHeight * info.width) / info.height / 2) * 2);
        const output = `${videoFolders.work}/cache/strip-${pathKey(path)}.jpg`;
        await ensureDirectory(`${videoFolders.work}/cache`);
        const factory = await ffmpeg();
        const command = factory(path).noAudio().videoFilters(`fps=${count / info.duration},scale=${width}:${stripHeight},tile=${count}x1`).frames(1).outputOptions(["-q:v", "6"]);
        // 长文件只取关键帧，速度快得多，作为缩略图足够。
        if (info.duration > 300) command.inputOptions(["-skip_frame", "nokey"]);
        await workLimit(() => run(command, output));
        const bytes = await files.read(output);
        lifetime.signal.throwIfAborted();
        const image = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
        stripUrls.push(image);
        return { count, width, height: stripHeight, duration: info.duration, image };
      })().catch(() => null);
      strips.set(path, job);
    }
    return job;
  }

  /** 图片或视频的小缩略图地址（视频取 0.5 秒处），素材网格与图片片段使用。 */
  function thumbOf(path: string) {
    let job = thumbs.get(path);
    if (!job) {
      job = workLimit(async () => {
        const output = `${videoFolders.work}/cache/thumb-${pathKey(path)}.jpg`;
        await ensureDirectory(`${videoFolders.work}/cache`);
        const factory = await ffmpeg();
        const command = factory(path).noAudio().frames(1).videoFilters("scale='min(240,iw)':-2").outputOptions(["-q:v", "5"]);
        if (mediaKind(path) === "video") command.seekInput(0.5);
        await run(command, output).catch(error => {
          // 极短的视频没有 0.5 秒处的画面，改取首帧。
          if (mediaKind(path) !== "video") throw error;
          return run(factory(path).noAudio().frames(1).videoFilters("scale='min(240,iw)':-2"), output);
        });
        const bytes = await files.read(output);
        lifetime.signal.throwIfAborted();
        const image = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
        stripUrls.push(image);
        return image;
      }).catch(() => null);
      thumbs.set(path, job);
    }
    return job;
  }

  /** 源文件 `at` 秒处的原尺寸静帧，存入素材目录，返回路径。 */
  async function still(src: string, at: number, name: string) {
    const output = await freePath(`${videoFolders.assets}/stills`, `${name.replace(/\.[^.]+$/, "")}-${at.toFixed(2).replace(".", "_")}.png`);
    const factory = await ffmpeg();
    await run(factory(src).seekInput(Math.max(0, at)).frames(1), output);
    return output;
  }

  /** 浏览器录制的声音（webm / ogg）转为通用的 .m4a，返回路径。 */
  async function convertRecording(blob: Blob, extension: string) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const raw = await writeNew(`${videoFolders.work}/recordings`, `voice-${stamp}.${extension}`, blob);
    const output = await freePath(`${videoFolders.assets}/voiceovers`, `配音-${stamp}.m4a`);
    const factory = await ffmpeg();
    await run(factory(raw).noVideo().audioCodec("aac").audioBitrate("160k"), output);
    return output;
  }

  /** 从本机导入的文件写入素材目录，返回路径。 */
  const importFile = (file: File) => writeNew(`${videoFolders.assets}/imports`, file.name, file);

  /**
   * 写入浏览器绘制的文字与蒙版 PNG 以及滤镜图，返回渲染所需的计划。
   * ACT: 临时文件按序号命名并在下次渲染时覆盖，不做删除；文字与蒙版数量即临时文件上限。
   */
  async function prepare(doc: VideoDoc, options: PlanOptions, signal?: AbortSignal) {
    signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    signal.throwIfAborted();
    const soundOnly = options.format === "mp3" || options.format === "wav";
    if (soundOnly ? !doc.clips.some(clip => clip.kind !== "image" && clip.kind !== "effect") : !doc.clips.some(clip => isVisual(clip)) && !doc.texts.length) {
      throw new Error(soundOnly ? "请先在时间线上放置视频或音频片段" : "请先在时间线上放置片段或文字");
    }
    const media = doc.clips.filter(clip => clip.kind !== "effect");
    const probed = new Map<string, Probe | null>();
    await Promise.all([...new Set(media.map(clip => clip.src))].map(async src => probed.set(src, await probe(src).catch(() => null))));
    const missing = media.find(clip => !probed.get(clip.src));
    if (missing) throw new Error(`无法读取文件：${missing.src}`);
    const full: VideoDoc = { ...doc, clips: doc.clips.map(clip => (clip.kind === "effect" || (clip.width && clip.height) ? clip : { ...clip, width: probed.get(clip.src)?.width ?? undefined, height: probed.get(clip.src)?.height ?? undefined })) };
    const folder = `${videoFolders.work}/render`;
    await ensureDirectory(folder);
    const assets: AssetFiles = { masks: {}, texts: {}, boxes: {} };
    let index = 0;
    for (const text of full.texts) {
      signal?.throwIfAborted();
      const png = await textPng(text, full.width, full.height);
      if (!png) continue;
      const path = `${folder}/text-${index++}.png`;
      await files.write(path, png);
      assets.texts[text.id] = path;
      if (text.wipeIn || text.wipeOut) assets.boxes[text.id] = measureText(text, full.width, full.height);
    }
    index = 0;
    for (const clip of full.clips) {
      signal?.throwIfAborted();
      if (!needsMask(clip)) continue;
      const png = await maskPng(full, clip);
      if (!png) continue;
      const path = `${folder}/mask-${index++}.png`;
      await files.write(path, png);
      assets.masks[clip.id] = path;
    }
    const plan = exportPlan(full, clip => !!probed.get(clip.src)?.audio, assets, options);
    const graph = `${folder}/graph.txt`;
    await files.write(graph, plan.graph);
    const factory = await ffmpeg();
    const command = factory();
    for (const input of plan.inputs) command.input(input.path).inputOptions(input.options);
    command.outputOptions(["-filter_complex_script", graph, ...plan.outputOptions]);
    return { command, length: plan.length };
  }

  /** 渲染时间线 `at` 处的一帧为 PNG，返回路径。 */
  function renderFrame(doc: VideoDoc, at: number, name: string) {
    return queueRender(async () => {
      const { command } = await prepare(doc, { frameAt: at });
      const output = await freePath(videoFolders.exports, `${name}-帧-${at.toFixed(2).replace(".", "_")}.png`);
      await run(command, output);
      return output;
    });
  }

  /** 导出时间线；进度以 0–1 回报，返回输出路径。 */
  function runExport(doc: VideoDoc, options: PlanOptions, name: string, onProgress: (progress: number) => void, signal: AbortSignal) {
    return queueRender(async () => {
      signal.throwIfAborted();
      const { command, length } = await prepare(doc, options, signal);
      signal.throwIfAborted();
      const output = await freePath(videoFolders.exports, `${name}.${options.format ?? "mp4"}`);
      await run(command, output, signal, seconds => onProgress(Math.min(0.999, seconds / Math.max(length, 1e-3))));
      return output;
    });
  }

  function dispose() {
    lifetime.abort(new DOMException("剪辑面板已关闭", "AbortError"));
    for (const held of urls.values()) held.entry.release();
    urls.clear();
    for (const image of stripUrls) URL.revokeObjectURL(image);
  }

  return { files, url, acquire, probe, clipFor, peaksOf, stripOf, thumbOf, still, convertRecording, importFile, renderFrame, runExport, writeNew, ensureDirectory, dispose };
}
