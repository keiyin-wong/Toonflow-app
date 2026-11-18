// 剪辑时间线的数据规则：预览、编辑与导出共用。某时刻每个片段在哪、可见度与音量只在这里计算一次，保证预览与导出一致。
// 不依赖 DOM。

import type {
  VideoBlend, VideoClip, VideoDirection, VideoDoc, VideoEase, VideoEffect, VideoEffectKind, VideoKeyframe, VideoKeyProp, VideoKeys, VideoMarker, VideoMaskShape, VideoShape, VideoText, VideoTextStyle, VideoTrack, VideoTrackKind, VideoTransitionKind,
} from "./types";
import { mergeById, type Prefer } from "./merge";

export const uid = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 8);
export const imageSeconds = 3;
export const textSeconds = 3;
/** 片段可裁剪到的最短时长。 */
export const minSeconds = 0.1;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Windows 常见字体（其他系统会回退），中文字体在前。 */
export const fonts = ["Microsoft YaHei", "SimHei", "KaiTi", "FangSong", "SimSun", "Arial", "Arial Black", "Impact", "Georgia", "Times New Roman", "Comic Sans MS", "Consolas"];

export const subtitleStyle: VideoTextStyle = {
  font: "Microsoft YaHei", size: 4.2, bold: true, italic: false, color: "#ffffff", stroke: "#000000", strokeWidth: 14,
  background: "#000000", backgroundOpacity: 0, shadow: false, align: "center", x: 0.5, y: 0.82, maxWidth: 0.88,
};
export const titleStyle: VideoTextStyle = { ...subtitleStyle, size: 7, y: 0.18, strokeWidth: 0, shadow: true };

// ---- 图形、贴纸、混合模式与蒙版 ----

export const blends: VideoBlend[] = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "plus-lighter"];
export const maskShapes: VideoMaskShape[] = ["split", "bars", "rect", "ellipse", "heart", "diamond", "star", "triangle", "text"];

/** 新蒙版的初始位置（片段画框比例）。 */
export function newMask(shape: VideoMaskShape): NonNullable<VideoClip["mask"]> {
  if (shape === "split") return { shape, x: 0, y: 0, w: 1, h: 1, feather: 0, angle: 0 };
  if (shape === "bars") return { shape, x: 0, y: 0.12, w: 1, h: 0.76, feather: 0 };
  if (shape === "text") return { shape, x: 0.05, y: 0.3, w: 0.9, h: 0.4, feather: 0, text: "TEXT" };
  return { shape, x: 0.1, y: 0.1, w: 0.8, h: 0.8, feather: 0.05 };
}
export const shapeKinds: VideoShape["kind"][] = ["rect", "ellipse", "triangle", "polygon", "star", "heart", "line"];
export const eases: VideoEase[] = ["linear", "hold", "in", "out", "inOut"];

/** 新图形：约为画面短边的三成，白色。`aspect` 为画面宽高比。 */
export function newShape(kind: VideoShape["kind"], aspect: number): VideoShape {
  const side = 0.3;
  const w = aspect >= 1 ? side / aspect : side;
  const h = aspect >= 1 ? side : side * aspect;
  const base: VideoShape = { kind, w, h, fill: "#ffffff", fillOpacity: 1, stroke: "#000000", strokeWidth: 0 };
  if (kind === "line") return { ...base, w: w * 2, h: 0, fillOpacity: 0, stroke: "#ffffff", strokeWidth: 0.008 };
  if (kind === "polygon") return { ...base, sides: 6 };
  if (kind === "star") return { ...base, sides: 5 };
  return base;
}

/** 图形与贴纸的初始文字样式：只绘制图形，不带底框与描边。 */
export const shapeStyle: VideoTextStyle = { ...subtitleStyle, size: 5, strokeWidth: 0, backgroundOpacity: 0, shadow: false, y: 0.5 };

/** 贴纸为 Emoji，按文字绘制，导出时随文字 PNG 输出。 */
export const stickers: { group: string; items: string[] }[] = [
  { group: "表情", items: ["😀", "😂", "🥹", "😍", "😎", "🤔", "😱", "😭", "😡", "🥳", "😴", "🤯"] },
  { group: "手势", items: ["👍", "👎", "👏", "🙏", "👉", "👈", "👆", "👇", "✌️", "🤞", "💪", "👀"] },
  { group: "符号", items: ["❤️", "💔", "⭐", "✨", "🔥", "💯", "❓", "❗", "✅", "❌", "⚡", "💥"] },
  { group: "物品", items: ["🎬", "🎵", "📢", "💰", "🎁", "⏰", "📍", "🔔", "💡", "🏆", "🌹", "🍿"] },
  { group: "箭头", items: ["➡️", "⬅️", "⬆️", "⬇️", "↗️", "↘️", "🔄", "🔁", "▶️", "⏸️", "⏩", "⏪"] },
];

/** 规范化存储的图形；不是图形时返回 null。 */
function cleanShape(raw: unknown): VideoShape | null {
  if (!raw || typeof raw !== "object") return null;
  const shape = raw as Record<string, unknown>;
  if (!shapeKinds.includes(shape.kind as VideoShape["kind"])) return null;
  const colour = (value: unknown, fallback: string) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback);
  return {
    kind: shape.kind as VideoShape["kind"],
    w: clamp(num(shape.w, 0.3), 0, 4), h: clamp(num(shape.h, 0.3), 0, 4),
    fill: colour(shape.fill, "#ffffff"), fillOpacity: clamp(num(shape.fillOpacity, 1), 0, 1),
    stroke: colour(shape.stroke, "#000000"), strokeWidth: clamp(num(shape.strokeWidth, 0), 0, 0.2),
    ...(shape.radius !== undefined && { radius: clamp(num(shape.radius, 0), 0, 0.5) }),
    ...(shape.sides !== undefined && { sides: Math.round(clamp(num(shape.sides, 5), 3, 12)) }),
    ...(shape.rotation !== undefined && { rotation: num(shape.rotation, 0) }),
  };
}

// ---- 轨道 ----

export function newTrack(kind: VideoTrackKind, doc: VideoDoc | null, magnetic = false): VideoTrack {
  const prefix = kind === "video" ? "V" : kind === "audio" ? "A" : "T";
  const count = (doc?.tracks.filter(track => track.kind === kind).length ?? 0) + 1;
  return { id: uid(), kind, name: `${prefix}${count}`, ...(magnetic && { magnetic: true }) };
}

export function newDoc(): VideoDoc {
  const text: VideoTrack = { id: "t1", kind: "text", name: "字幕" };
  const video: VideoTrack = { id: "v1", kind: "video", name: "V1", magnetic: true };
  const audio: VideoTrack = { id: "a1", kind: "audio", name: "A1" };
  return { version: 2, width: 1080, height: 1920, fps: 30, background: "#000000", tracks: [text, video, audio], clips: [], texts: [], markers: [] };
}

export const magneticTrack = (doc: VideoDoc) => doc.tracks.find(track => track.magnetic)!;
export const trackOf = (doc: VideoDoc, id: string) => doc.tracks.find(track => track.id === id);
export const isMagnetic = (doc: VideoDoc, clip: VideoClip) => !!trackOf(doc, clip.track)?.magnetic;

/** 按 Premiere 的位置插入轨道：新视频轨在所有视频轨之上，音频轨在最下，文字轨在最上。 */
export function addTrack(doc: VideoDoc, kind: VideoTrackKind): { doc: VideoDoc; track: VideoTrack } {
  const track = newTrack(kind, doc);
  const tracks = [...doc.tracks];
  const firstVideo = tracks.findIndex(item => item.kind === "video");
  const lastAudio = tracks.map(item => item.kind).lastIndexOf("audio");
  const at = kind === "video" ? Math.max(0, firstVideo) : kind === "audio" ? (lastAudio < 0 ? tracks.length : lastAudio + 1) : 0;
  tracks.splice(at, 0, track);
  return { doc: { ...doc, tracks }, track };
}

/** 任意存储的时间线规范化为完整的第 2 版：补齐默认值、丢弃损坏项、确保恰好一条磁性视频轨。 */
export function normalizeDoc(raw: unknown): VideoDoc {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const base = newDoc();
  const width = Math.round(clamp(num(data.width, base.width), 16, 7680) / 2) * 2;
  const height = Math.round(clamp(num(data.height, base.height), 16, 7680) / 2) * 2;
  const fps = clamp(num(data.fps, base.fps), 1, 120);
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(item => item && typeof item === "object") : []);
  const validClip = (clip: any) =>
    typeof clip.id === "string" && typeof clip.src === "string" && ["video", "image", "audio", "effect"].includes(clip.kind) && num(clip.out, -1) > num(clip.in, 0) && (clip.kind !== "effect" || !!cleanEffect(clip.effect));

  let tracks: VideoTrack[] = list(data.tracks)
    .filter((track: any) => typeof track.id === "string" && ["video", "audio", "text"].includes(track.kind))
    .map((track: any) => ({ id: track.id, kind: track.kind, name: String(track.name ?? track.kind), ...(track.magnetic && track.kind === "video" && { magnetic: true }), ...(track.hidden && { hidden: true }), ...(track.muted && { muted: true }), ...(track.locked && { locked: true }) }));
  if (!tracks.length) tracks = base.tracks;
  const magnetic = tracks.filter(track => track.magnetic);
  if (magnetic.length !== 1) {
    tracks = tracks.map(track => ({ ...track, magnetic: undefined }));
    const video = tracks.filter(track => track.kind === "video").pop();
    if (video) video.magnetic = true;
    else {
      const audio = tracks.findIndex(track => track.kind === "audio");
      tracks.splice(audio < 0 ? tracks.length : audio, 0, { id: uid(), kind: "video", name: "V1", magnetic: true });
    }
  }
  for (const kind of ["text", "audio"] as const) if (!tracks.some(track => track.kind === kind)) tracks = addTrack({ ...base, tracks }, kind).doc.tracks;
  const kindOf = (id: string) => tracks.find(track => track.id === id)?.kind;
  const fits = (clip: any) => { const track = tracks.find(item => item.id === clip.track); return !!track && fitsTrack(clip, track); };
  const clips: VideoClip[] = list(data.clips).filter((clip: any) => validClip(clip) && fits(clip)).map((clip: any) => {
    const { blend, mask, effect, transition, ...rest } = cleanKeys(clip as VideoClip);
    const cleanTransitionValue = cleanTransition(transition);
    return {
      ...rest,
      in: Math.max(0, num(rest.in, 0)),
      out: Math.max(Math.max(0, num(rest.in, 0)) + minSeconds, num(rest.out, minSeconds)),
      start: Math.max(0, num(rest.start, 0)),
      speed: clamp(num(rest.speed, 1), 0.0625, 16),
      ...(cleanTransitionValue && { transition: cleanTransitionValue }),
      ...(rest.kind === "effect" && { src: "", effect: cleanEffect(effect)! }),
      ...(blend && blend !== "normal" && blends.includes(blend) && { blend }),
      ...(mask && { mask: { ...mask, shape: maskShapes.includes(mask.shape) ? mask.shape : "rect" } }),
    };
  });
  const motion = (value: unknown) => (["up", "down", "left", "right"].includes(value as string) ? (value as VideoText["motionIn"]) : undefined);
  const texts: VideoText[] = list(data.texts)
    .filter((text: any) => typeof text.id === "string" && typeof text.text === "string" && kindOf(text.track) === "text")
    .map((text: any) => {
      const { shape, ...rest } = text;
      const cleanShapeValue = cleanShape(shape);
      return { ...rest, ...(cleanShapeValue && { shape: cleanShapeValue }), motionIn: motion(text.motionIn), motionOut: motion(text.motionOut), start: Math.max(0, num(text.start, 0)), duration: Math.max(minSeconds, num(text.duration, textSeconds)), style: { ...subtitleStyle, ...(text.style ?? {}) } };
    });
  const markers: VideoMarker[] = list(data.markers).filter((marker: any) => typeof marker.id === "string").map((marker: any) => ({ id: marker.id, time: Math.max(0, num(marker.time, 0)), label: String(marker.label ?? "") }));
  return { version: 2, width, height, fps, background: typeof data.background === "string" ? data.background : "#000000", tracks, clips, texts, markers };
}

/** 片段能否放在轨道上：画面放视频轨，声音放音频轨，特效放非磁性视频轨。 */
export const fitsTrack = (clip: Pick<VideoClip, "kind">, track: VideoTrack) =>
  clip.kind === "effect" ? track.kind === "video" && !track.magnetic : track.kind === "video" ? clip.kind !== "audio" : track.kind === "audio" ? clip.kind !== "image" : false;

// ---- 位置 ----

/** 没有文件时间的片段（图片或特效）：时长为 out − in，不受速度影响。 */
export const isStill = (clip: Pick<VideoClip, "kind">) => clip.kind === "image" || clip.kind === "effect";

/** 片段在时间线上的时长。 */
export const clipLength = (clip: VideoClip) => (isStill(clip) ? clip.out - clip.in : (clip.out - clip.in) / (clip.speed ?? 1));

export interface Place {
  start: number;
  end: number;
  /** 进入此片段的转场（磁性轨），时长已按两段片段的长度裁短。 */
  into?: { kind: VideoTransitionKind; d: number; dir?: VideoDirection };
  /** 离开此片段进入下一段的转场。 */
  outOf?: { kind: VideoTransitionKind; d: number; dir?: VideoDirection };
}

/** 计算每个片段的位置：磁性轨片段首尾相接，转场处两段重叠。 */
export function placeAll(doc: VideoDoc): Map<string, Place> {
  const places = new Map<string, Place>();
  const magneticId = magneticTrack(doc)?.id;
  let cursor = 0;
  let previous: { clip: VideoClip; place: Place } | null = null;
  for (const clip of doc.clips) {
    if (clip.track !== magneticId) {
      const start = Math.max(0, clip.start ?? 0);
      places.set(clip.id, { start, end: start + clipLength(clip) });
      continue;
    }
    const length = clipLength(clip);
    const place: Place = { start: cursor, end: cursor + length };
    if (previous && clip.transition && clip.transition.duration > 0) {
      const duration = Math.min(clip.transition.duration, clipLength(previous.clip) - minSeconds, length - minSeconds);
      if (duration > 0.01) {
        place.start = cursor - duration;
        place.end = place.start + length;
        const dir = transitionDirected.includes(clip.transition.kind) ? clip.transition.direction ?? "left" : undefined;
        place.into = { kind: clip.transition.kind, d: duration, ...(dir && { dir }) };
        previous.place.outOf = { kind: clip.transition.kind, d: duration, ...(dir && { dir }) };
      }
    }
    places.set(clip.id, place);
    cursor = place.end;
    previous = { clip, place };
  }
  return places;
}

/** 成片时长：所有轨道上最后结束的内容。 */
export function docLength(doc: VideoDoc, places = placeAll(doc)): number {
  let end = 0;
  for (const place of places.values()) end = Math.max(end, place.end);
  for (const text of doc.texts) end = Math.max(end, text.start + text.duration);
  return end;
}

/** 磁性轨上按顺序排列的片段及位置。 */
export function sequence(doc: VideoDoc, places = placeAll(doc)) {
  const magneticId = magneticTrack(doc)?.id;
  return doc.clips.filter(clip => clip.track === magneticId).map(clip => ({ clip, ...places.get(clip.id)! }));
}

// ---- 某时刻片段的样子 ----

export const isVisual = (clip: VideoClip) => clip.kind !== "audio" && clip.kind !== "effect";
/** 片段画面是否绘制：非声音文件且未隐藏（隐藏片段的声音仍会播放）。 */
export const isDrawn = (clip: VideoClip) => isVisual(clip) && !clip.hidden;
/** 文字项是否有内容：文字或图形。 */
export const hasContent = (text: VideoText) => !!text.shape || !!text.text.trim();

/** 片段画框像素尺寸，取偶数（yuv420 需要）。`scale` 默认为片段固定值。 */
export function boxSize(doc: VideoDoc, clip: VideoClip, scale = clip.scale ?? 1): { w: number; h: number } {
  const sourceWidth = clip.width || doc.width;
  const sourceHeight = clip.height || doc.height;
  const fit = clip.fit ?? "fit";
  const base = fit === "fill" ? Math.max(doc.width / sourceWidth, doc.height / sourceHeight) : Math.min(doc.width / sourceWidth, doc.height / sourceHeight);
  const factor = base * Math.max(0.01, scale);
  return { w: Math.max(2, Math.round((sourceWidth * factor) / 2) * 2), h: Math.max(2, Math.round((sourceHeight * factor) / 2) * 2) };
}

/** 片段起点为 0，终点为 1。 */
export const progress = (place: Place, time: number) => clamp((time - place.start) / Math.max(1e-6, place.end - place.start), 0, 1);

/** `time` 时画框中心（画面比例），受 `moveTo` 或位置关键帧影响。 */
export function centreAt(clip: VideoClip, place: Place, time: number): { x: number; y: number } {
  if (isKeyed(clip, "x") || isKeyed(clip, "y")) return { x: propAt(clip, "x", place, time), y: propAt(clip, "y", place, time) };
  const x0 = clip.x ?? 0.5;
  const y0 = clip.y ?? 0.5;
  if (!clip.moveTo) return { x: x0, y: y0 };
  const k = progress(place, time);
  return { x: x0 + (clip.moveTo.x - x0) * k, y: y0 + (clip.moveTo.y - y0) * k };
}

// ---- 关键帧 ----

export const keyProps: VideoKeyProp[] = ["x", "y", "scale", "rotation", "opacity", "volume"];
/** 两个关键帧间隔小于此值视为同一帧。 */
const keyEps = 1e-3;

export const isKeyed = (clip: VideoClip, prop: VideoKeyProp) => !!clip.keys?.[prop]?.length;

/** 属性的固定值：没有关键帧时的取值。 */
export function fixedValue(clip: VideoClip, prop: VideoKeyProp): number {
  switch (prop) {
    case "x": return clip.x ?? 0.5;
    case "y": return clip.y ?? 0.5;
    case "scale": return clip.scale ?? 1;
    case "rotation": return clip.rotation ?? 0;
    case "opacity": return clip.opacity ?? 1;
    case "volume": return clip.volume ?? 1;
  }
}

/** 两关键帧之间进度 `k` 按前一帧缓动换算后的比例（0–1）。 */
export function eased(ease: VideoEase | undefined, k: number): number {
  switch (ease) {
    case "hold": return k >= 1 ? 1 : 0;
    case "in": return k * k;
    case "out": return 1 - (1 - k) * (1 - k);
    case "inOut": return k * k * (3 - 2 * k);
    default: return k;
  }
}

/** 片段内 `local` 秒处的关键帧值：首帧之前与末帧之后保持不变。 */
export function keysAt(keys: VideoKeyframe[], local: number): number {
  if (local <= keys[0]!.t) return keys[0]!.v;
  for (let index = 1; index < keys.length; index++) {
    const a = keys[index - 1]!;
    const b = keys[index]!;
    if (local <= b.t) return b.t - a.t < 1e-9 ? b.v : a.v + (b.v - a.v) * eased(a.ease, (local - a.t) / (b.t - a.t));
  }
  return keys[keys.length - 1]!.v;
}

/** 时间线 `time` 处的属性值：有关键帧取关键帧，否则取固定值。 */
export function propAt(clip: VideoClip, prop: VideoKeyProp, place: Place, time: number): number {
  const keys = clip.keys?.[prop];
  return keys?.length ? keysAt(keys, time - place.start) : fixedValue(clip, prop);
}

/** 片段最大缩放：导出时按此尺寸生成画框，再逐帧缩小。 */
export function maxScale(clip: VideoClip): number {
  const keys = clip.keys?.scale;
  return keys?.length ? Math.max(...keys.map(key => key.v), 0.01) : clip.scale ?? 1;
}

/** 片段所有关键帧时间（任意属性，相对起点），已排序。 */
export function keyTimes(clip: VideoClip): number[] {
  const times = new Set<number>();
  for (const prop of keyProps) for (const key of clip.keys?.[prop] ?? []) times.add(Math.round(key.t * 1000) / 1000);
  return [...times].sort((a, b) => a - b);
}

export const hasKeyAt = (clip: VideoClip, prop: VideoKeyProp, local: number) => !!clip.keys?.[prop]?.some(key => Math.abs(key.t - local) <= keyEps);

/** 设置一个关键帧后的 `keys`（新增或替换该时间处的关键帧）。 */
export function withKey(clip: VideoClip, prop: VideoKeyProp, local: number, value: number): VideoKeys {
  const old = clip.keys?.[prop]?.find(key => Math.abs(key.t - local) <= keyEps);
  const list = (clip.keys?.[prop] ?? []).filter(key => key !== old);
  const key: VideoKeyframe = { t: Math.max(0, Math.round(local * 1000) / 1000), v: value, ...(old?.ease && { ease: old.ease }) };
  return { ...clip.keys, [prop]: [...list, key].sort((a, b) => a.t - b.t) };
}

/** `local` 处关键帧的缓动（取 `props` 中第一个有关键帧的属性）。 */
export const easeAt = (clip: VideoClip, props: VideoKeyProp[], local: number): VideoEase | undefined => {
  for (const prop of props) {
    const key = clip.keys?.[prop]?.find(item => Math.abs(item.t - local) <= keyEps);
    if (key) return key.ease ?? "linear";
  }
  return undefined;
};

/** 将 `local` 处各属性关键帧的缓动设为 `ease` 后的 `keys`。 */
export function withEase(clip: VideoClip, props: VideoKeyProp[], local: number, ease: VideoEase): VideoKeys | undefined {
  const keys: VideoKeys = { ...clip.keys };
  for (const prop of props) {
    keys[prop] = keys[prop]?.map(key => {
      if (Math.abs(key.t - local) > keyEps) return key;
      const { ease: _ease, ...rest } = key;
      return ease === "linear" ? rest : { ...rest, ease };
    });
  }
  return tidyKeys(keys);
}

/** 删除该时间关键帧后的 `keys`；全部删光时为 undefined。 */
export function withoutKey(clip: VideoClip, prop: VideoKeyProp, local: number): VideoKeys | undefined {
  return tidyKeys({ ...clip.keys, [prop]: (clip.keys?.[prop] ?? []).filter(key => Math.abs(key.t - local) > keyEps) });
}

/** 去掉空列表；没有任何关键帧时为 undefined。 */
export function tidyKeys(keys: VideoKeys | undefined): VideoKeys | undefined {
  if (!keys) return undefined;
  const result: VideoKeys = {};
  for (const prop of keyProps) if (keys[prop]?.length) result[prop] = keys[prop];
  return Object.keys(result).length ? result : undefined;
}

/** 在时间线 `time` 处设置属性：已开启动画则写关键帧，否则改固定值。 */
export function setProp(clip: VideoClip, place: Place, prop: VideoKeyProp, time: number, value: number): Partial<VideoClip> {
  if (isKeyed(clip, prop)) return { keys: withKey(clip, prop, time - place.start, value) };
  return { [prop]: value } as Partial<VideoClip>;
}

/** 同时设置多个属性。 */
export function setProps(clip: VideoClip, place: Place, time: number, values: Partial<Record<VideoKeyProp, number>>): Partial<VideoClip> {
  let next = clip;
  let patch: Partial<VideoClip> = {};
  for (const [prop, value] of Object.entries(values) as [VideoKeyProp, number][]) {
    const one = setProp(next, place, prop, time, value);
    next = { ...next, ...one };
    patch = { ...patch, ...one };
  }
  return patch;
}

/** 片段内容起点后移 `d` 秒（裁剪或切割）后的关键帧：全部前移，落到起点之前的丢弃，并在 0 处保留当时的值。 */
export function shiftKeys(keys: VideoKeys | undefined, d: number): VideoKeys | undefined {
  if (!keys || Math.abs(d) < 1e-9) return keys;
  const result: VideoKeys = {};
  for (const prop of keyProps) {
    const list = keys[prop];
    if (!list?.length) continue;
    const moved = list.map(key => ({ ...key, t: Math.round((key.t - d) * 1000) / 1000 }));
    const after = moved.filter(key => key.t > keyEps);
    // 新首帧沿用被切开那段的缓动。
    const cutFrom = [...moved].reverse().find(key => key.t <= keyEps);
    result[prop] = after.length < moved.length || !after.length ? [{ t: 0, v: keysAt(list, d), ...(cutFrom?.ease && { ease: cutFrom.ease }) }, ...after] : after;
  }
  return tidyKeys(result);
}

/** 加载时只保留合法关键帧：已知属性、有限数值、按时间排序。 */
function cleanKeys(clip: VideoClip): VideoClip {
  if (!clip.keys) return clip;
  const raw = (typeof clip.keys === "object" ? clip.keys : {}) as Record<string, unknown>;
  const keys: VideoKeys = {};
  for (const prop of keyProps) {
    const list = Array.isArray(raw[prop]) ? (raw[prop] as { t: unknown; v: unknown; ease?: unknown }[]).filter(key => key && Number.isFinite(key.t) && Number.isFinite(key.v)) : [];
    const ease = (value: unknown) => (eases.includes(value as VideoEase) && value !== "linear" ? { ease: value as VideoEase } : {});
    if (list.length) keys[prop] = list.map(key => ({ t: Math.max(0, Number(key.t)), v: Number(key.v), ...ease(key.ease) })).sort((a, b) => a.t - b.t);
  }
  const { keys: _keys, ...rest } = clip;
  const tidy = tidyKeys(keys);
  return tidy ? { ...rest, keys: tidy } : rest;
}

/** Ken Burns 在 `time` 显示的画框区域（画框比例的左上角与尺寸）。 */
export function kenBurnsAt(clip: VideoClip, place: Place, time: number): { x: number; y: number; w: number; h: number } | null {
  if (!clip.kenBurns) return null;
  const k = progress(place, time);
  const { from, to } = clip.kenBurns;
  const zoom = Math.max(1, from.zoom + (to.zoom - from.zoom) * k);
  const focusX = from.x + (to.x - from.x) * k;
  const focusY = from.y + (to.y - from.y) * k;
  const size = 1 / zoom;
  return { x: clamp(focusX - size / 2, 0, 1 - size), y: clamp(focusY - size / 2, 0, 1 - size), w: size, h: size };
}

/** `w` × `h` 画框的边框像素（偶数）；无边框为 0。 */
export const borderPx = (clip: Pick<VideoClip, "border">, w: number, h: number) =>
  clip.border && clip.border.width > 0 ? Math.max(2, Math.round((clip.border.width * Math.min(w, h)) / 2) * 2) : 0;

/** 导出是否需要浏览器绘制的蒙版图（裁切、蒙版或不透明度）。 */
export const needsMask = (clip: VideoClip) =>
  isVisual(clip) && (!!clip.mask || (!isKeyed(clip, "opacity") && (clip.opacity ?? 1) < 1) || !!(clip.crop && (clip.crop.left || clip.crop.top || clip.crop.right || clip.crop.bottom)));

/** 片段画面在 `time` 的可见度：透明度（淡入淡出、叠化）以及闪色转场的程度。`shown` 为 false 表示尚未显示。 */
export function visibilityAt(clip: VideoClip, place: Place, time: number): { shown: boolean; alpha: number; dip: { color: string; amount: number } | null } {
  let alpha = 1;
  let dip: { color: string; amount: number } | null = null;
  if (clip.fadeIn && time < place.start + clip.fadeIn) alpha *= clamp((time - place.start) / clip.fadeIn, 0, 1);
  if (clip.fadeOut && time > place.end - clip.fadeOut) alpha *= clamp((place.end - time) / clip.fadeOut, 0, 1);
  const colorOf = (kind: string) => (kind === "dipWhite" ? "#ffffff" : "#000000");
  if (place.into) {
    const { kind, d } = place.into;
    const style = transitionStyle(kind);
    if (style === "fade") alpha *= clamp((time - place.start) / d, 0, 1);
    else if (style === "cut" && time < place.start + d / 2) return { shown: false, alpha: 0, dip: null };
    else if (style === "dip") {
      if (time < place.start + d / 2) return { shown: false, alpha: 0, dip: null };
      dip = { color: colorOf(kind), amount: 1 - clamp((time - place.start - d / 2) / (d / 2), 0, 1) };
    }
  }
  if (place.outOf && transitionStyle(place.outOf.kind) === "dip") {
    const { kind, d } = place.outOf;
    const amount = clamp((time - (place.end - d)) / (d / 2), 0, 1);
    if (amount > 0) dip = { color: colorOf(kind), amount: Math.max(dip?.amount ?? 0, amount) };
  }
  return { shown: true, alpha, dip };
}

/** 片段在 `time` 的音量（音量 × 淡入淡出 × 交叉淡化），静音为 0。 */
export function gainAt(clip: VideoClip, place: Place, time: number, trackMuted = false): number {
  if (clip.muted || trackMuted || time < place.start || time >= place.end) return 0;
  let gain = propAt(clip, "volume", place, time);
  if (clip.audioFadeIn && time < place.start + clip.audioFadeIn) gain *= (time - place.start) / clip.audioFadeIn;
  if (clip.audioFadeOut && time > place.end - clip.audioFadeOut) gain *= (place.end - time) / clip.audioFadeOut;
  if (place.into) {
    const { kind, d } = place.into;
    gain *= transitionStyle(kind) !== "dip" ? clamp((time - place.start) / d, 0, 1) : clamp((time - place.start - d / 2) / (d / 2), 0, 1);
  }
  if (place.outOf) {
    const { kind, d } = place.outOf;
    gain *= transitionStyle(kind) !== "dip" ? clamp((place.end - time) / d, 0, 1) : clamp((place.end - d / 2 - time) / (d / 2), 0, 1);
  }
  return Math.max(0, gain);
}

/** 文字在 `time` 的透明度。 */
export function textAlphaAt(text: VideoText, time: number): number {
  if (time < text.start || time >= text.start + text.duration) return 0;
  let alpha = 1;
  if (text.fadeIn && time < text.start + text.fadeIn) alpha *= (time - text.start) / text.fadeIn;
  if (text.fadeOut && time > text.start + text.duration - text.fadeOut) alpha *= (text.start + text.duration - time) / text.fadeOut;
  return clamp(alpha, 0, 1);
}

/** 有滑动但无淡入淡出时的滑动时长。 */
export const motionSeconds = 0.4;
/** 滑动距离（画面宽 / 高的比例）。 */
export const motionDistance = { x: 0.08, y: 0.06 };

/** 文字滑入滑出在 `time` 的位移（画面比例）：沿 `motionIn` 方向缓出滑入，沿 `motionOut` 方向缓入滑出。 */
export function textOffsetAt(text: VideoText, time: number): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  const along = (motion: NonNullable<VideoText["motionIn"]>, k: number) => {
    if (motion === "left") dx -= motionDistance.x * k;
    else if (motion === "right") dx += motionDistance.x * k;
    else if (motion === "up") dy -= motionDistance.y * k;
    else dy += motionDistance.y * k;
  };
  if (text.motionIn) {
    const k = clamp((time - text.start) / (text.fadeIn || motionSeconds), 0, 1);
    along(text.motionIn, -(1 - k) * (1 - k));
  }
  if (text.motionOut) {
    const duration = text.fadeOut || motionSeconds;
    const k = clamp((time - (text.start + text.duration - duration)) / duration, 0, 1);
    along(text.motionOut, k * k);
  }
  return { dx, dy };
}

// 模糊擦除：柔和边缘自左向右扫过文字框，边缘之前 textWipeSoft 宽度内显示模糊副本。
export const textWipeSeconds = 0.8;
export const textWipeSoft = 0.15;
/** 模糊副本的标准差（画面宽度比例）。 */
export const textWipeBlur = 0.006;

/** 模糊擦除在 `time` 的进度（0 未显示到 1 全显示），无擦除时为 null；出场方向相反。 */
export function textWipeAt(text: VideoText, time: number): number | null {
  if (text.wipeIn && time < text.start + text.wipeIn) return clamp((time - text.start) / text.wipeIn, 0, 1);
  if (text.wipeOut && time > text.start + text.duration - text.wipeOut) return clamp((text.start + text.duration - time) / text.wipeOut, 0, 1);
  return null;
}

/** 擦除进度为 `k` 时，文字框内 `u` 处清晰副本与模糊副本的透明度。 */
export function textWipeAlpha(k: number, u: number): { sharp: number; blur: number } {
  const soft = textWipeSoft;
  const edge = k * (1 + 2 * soft);
  const sharp = clamp((edge - soft - u) / soft, 0, 1);
  return { sharp, blur: clamp((edge - u) / soft, 0, 1) - sharp };
}

/** 视频轨从后到前（列表底部先绘制）。 */
export const videoTracksBackToFront = (doc: VideoDoc) => doc.tracks.filter(track => track.kind === "video").reverse();
/** 文字轨从后到前：全部绘制在视频之上，最上方的最后绘制。 */
export const textTracksBackToFront = (doc: VideoDoc) => doc.tracks.filter(track => track.kind === "text").reverse();

// ---- 字幕 ----

const srtTime = (time: number) => {
  const ms = Math.round(Math.max(0, time) * 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

/** 解析 .srt（或 .vtt）字幕。 */
export function parseSrt(text: string): { start: number; end: number; text: string }[] {
  const time = (value: string) => {
    const match = /(?:(\d+):)?(\d+):(\d+)[,.](\d+)/.exec(value);
    return match ? Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]!.padEnd(3, "0").slice(0, 3)) / 1000 : NaN;
  };
  const cues: { start: number; end: number; text: string }[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter(line => line.trim() !== "");
    const index = lines.findIndex(line => line.includes("-->"));
    if (index < 0) continue;
    const [a, b] = lines[index]!.split("-->");
    const start = time(a ?? "");
    const end = time(b ?? "");
    const words = lines.slice(index + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && words) cues.push({ start, end, text: words });
  }
  return cues;
}

/** 文字轨导出为 .srt。 */
export function formatSrt(texts: VideoText[]): string {
  return [...texts]
    .sort((a, b) => a.start - b.start)
    .map((text, index) => `${index + 1}\n${srtTime(text.start)} --> ${srtTime(text.start + text.duration)}\n${text.text}\n`)
    .join("\n");
}

// ---- 合并 ----

/** 两份都基于 `base` 的时间线按项合并；双方都改过画面设置时 `conflicts` 记录 `frame`。 */
export function mergeDocs(base: VideoDoc, mine: VideoDoc, theirs: VideoDoc, prefer: Prefer = "mine", conflicts?: string[]): VideoDoc {
  let frameClash = false;
  const scalar = <K extends "width" | "height" | "fps" | "background">(key: K) => {
    if (mine[key] === base[key]) return theirs[key];
    if (theirs[key] === base[key] || theirs[key] === mine[key]) return mine[key];
    frameClash = true;
    return prefer === "mine" ? mine[key] : theirs[key];
  };
  const doc = normalizeDoc({
    version: 2,
    width: scalar("width"), height: scalar("height"), fps: scalar("fps"), background: scalar("background"),
    tracks: mergeById(base.tracks, mine.tracks, theirs.tracks, prefer, conflicts),
    clips: mergeById(base.clips, mine.clips, theirs.clips, prefer, conflicts),
    texts: mergeById(base.texts, mine.texts, theirs.texts, prefer, conflicts),
    markers: mergeById(base.markers, mine.markers, theirs.markers, prefer, conflicts),
  });
  if (frameClash) conflicts?.push("frame");
  return doc;
}

// ---- 编辑操作 ----

/** 在时间线 `at` 处把片段和文字切成两段，返回新时间线及每项后半段的 id；`at` 不在内部（或在边缘）的不动。 */
export function splitItems(doc: VideoDoc, ids: string[], at: number): { doc: VideoDoc; made: Record<string, string> } {
  const places = placeAll(doc);
  const made: Record<string, string> = {};
  const clips: VideoClip[] = [];
  for (const clip of doc.clips) {
    const place = places.get(clip.id)!;
    if (!ids.includes(clip.id) || at - place.start < minSeconds || place.end - at < minSeconds) {
      clips.push(clip);
      continue;
    }
    const still = isStill(clip);
    const cut = clip.in + (at - place.start) * (still ? 1 : clip.speed ?? 1);
    const { transition: _transition, keys: _keys, ...rest } = clip;
    const keys = shiftKeys(clip.keys, at - place.start);
    const second: VideoClip = { ...rest, id: uid(), in: still ? 0 : cut, out: still ? place.end - at : clip.out, ...(clip.start !== undefined && { start: at }), ...(keys && { keys }) };
    const { fadeOut: _fadeOut, audioFadeOut: _audioFadeOut, ...first } = { ...clip, out: still ? at - place.start : cut };
    const { fadeIn: _fadeIn, audioFadeIn: _audioFadeIn, ...secondClean } = second;
    clips.push(first, secondClean);
    made[clip.id] = second.id;
  }
  const texts: VideoText[] = [];
  for (const text of doc.texts) {
    if (!ids.includes(text.id) || at - text.start < minSeconds || text.start + text.duration - at < minSeconds) {
      texts.push(text);
      continue;
    }
    const second = { ...text, id: uid(), start: at, duration: text.start + text.duration - at };
    texts.push({ ...text, duration: at - text.start }, second);
    made[text.id] = second.id;
  }
  return { doc: Object.keys(made).length ? { ...doc, clips, texts } : doc, made };
}

/** 切口两侧在文件和时间线上的允许误差（秒）。 */
const joinEps = 0.05;

/** `b` 是否紧接 `a`：同一文件同一速度，b 从 a 结束处继续，且在时间线上相邻。 */
function joinable(a: VideoClip, b: VideoClip, places: Map<string, Place>): boolean {
  if (a.track !== b.track || a.kind !== b.kind || a.src !== b.src || a.kind === "effect" || b.transition) return false;
  if (!isStill(a) && ((a.speed ?? 1) !== (b.speed ?? 1) || Math.abs(a.out - b.in) > joinEps)) return false;
  return Math.abs(places.get(a.id)!.end - places.get(b.id)!.start) <= joinEps;
}

/** 撤销切割：把片段与紧接的那段接回去。多选时只合并选中的；保留第一段的 id 与设置，取最后一段的结尾、淡出与关键帧。 */
export function joinItems(doc: VideoDoc, ids: string[]): VideoDoc {
  const places = placeAll(doc);
  const picked = new Set(ids);
  const one = ids.length === 1;
  const gone = new Set<string>();
  const changed = new Map<string, VideoClip>();
  for (const track of doc.tracks) {
    const row = doc.clips.filter(clip => clip.track === track.id).sort((p, q) => places.get(p.id)!.start - places.get(q.id)!.start);
    let head: VideoClip | null = null;
    let headLength = 0;
    for (const clip of row) {
      const previous: VideoClip | null = head;
      const join = previous && joinable(previous, clip, places) && (one ? picked.has(previous.id) || picked.has(clip.id) || gone.has(previous.id) || changed.has(previous.id) : picked.has(previous.id) && picked.has(clip.id));
      if (!previous || !join) {
        head = clip;
        headLength = clipLength(clip);
        continue;
      }
      const keys: VideoKeys = { ...previous.keys };
      for (const [prop, list] of Object.entries(clip.keys ?? {}) as [keyof VideoKeys, VideoKeyframe[]][]) {
        keys[prop] = [...(keys[prop] ?? []).filter(key => key.t < headLength - keyEps), ...list.map(key => ({ ...key, t: Math.round((key.t + headLength) * 1000) / 1000 }))];
      }
      const { fadeOut: _fadeOut, audioFadeOut: _audioFadeOut, keys: _keys, ...rest } = previous;
      const grown: VideoClip = {
        ...rest,
        out: isStill(previous) ? previous.out + clipLength(clip) : clip.out,
        ...(clip.fadeOut !== undefined && { fadeOut: clip.fadeOut }),
        ...(clip.audioFadeOut !== undefined && { audioFadeOut: clip.audioFadeOut }),
        ...(Object.keys(keys).length && { keys }),
      };
      head = grown;
      headLength += clipLength(clip);
      changed.set(grown.id, grown);
      gone.add(clip.id);
    }
  }
  if (!gone.size) return doc;
  return { ...doc, clips: doc.clips.filter(clip => !gone.has(clip.id)).map(clip => changed.get(clip.id) ?? clip) };
}

/** `joinItems(doc, ids)` 是否会合并任何片段。 */
export const canJoin = (doc: VideoDoc, ids: string[]) => joinItems(doc, ids) !== doc;

// ---- 特效（调整图层）----
//
// 特效片段在持续期间改变其下绘制的所有内容。以下数值即每种特效的完整定义：预览直接计算这些函数，导出把相同公式写成 FFmpeg 表达式。
// 修改一处必须同步另一处。

export const effectKinds: VideoEffectKind[] = ["shake", "flash", "glitch", "vignette", "oldFilm", "grain", "lightLeak", "dirBlur", "adjust"];
export const effectNames: Record<VideoEffectKind, string> = {
  adjust: "调整图层", shake: "镜头抖动", flash: "闪光", vignette: "暗角", grain: "胶片颗粒",
  oldFilm: "老电影", glitch: "故障", lightLeak: "漏光", dirBlur: "方向模糊", zoom: "缩放", spin: "旋转",
};
/** 新特效的时长。 */
export const effectSeconds: Record<VideoEffectKind, number> = { adjust: 3, shake: 0.8, flash: 0.5, vignette: 3, grain: 3, oldFilm: 3, glitch: 1.5, lightLeak: 2, dirBlur: 0.4, zoom: 0.5, spin: 0.6 };
const effectAmount: Record<VideoEffectKind, number> = { adjust: 1, shake: 0.5, flash: 0.9, vignette: 0.6, grain: 0.4, oldFilm: 0.7, glitch: 0.6, lightLeak: 0.7, dirBlur: 0.5, zoom: 1, spin: 1 };
const effectColor: Partial<Record<VideoEffectKind, string>> = { flash: "#ffffff", lightLeak: "#ff9a3c" };

export const isEffect = (clip: Pick<VideoClip, "kind">) => clip.kind === "effect";

/** 规范化存储的特效；不是特效时返回 null。 */
export function cleanEffect(raw: unknown): VideoEffect | null {
  if (!raw || typeof raw !== "object") return null;
  const effect = raw as Record<string, unknown>;
  if (!effectKinds.includes(effect.kind as VideoEffectKind)) return null;
  const kind = effect.kind as VideoEffectKind;
  const color = typeof effect.color === "string" && /^#[0-9a-f]{6}$/i.test(effect.color) ? effect.color : effectColor[kind];
  return {
    kind,
    amount: clamp(num(effect.amount, effectAmount[kind]), 0, 1),
    ...(color && { color }),
    ...(kind === "dirBlur" && { direction: effect.direction === "vertical" ? "vertical" as const : "horizontal" as const }),
  };
}

/** 在 `track` 上 `start` 处新建特效片段。 */
export function newEffect(kind: VideoEffectKind, track: string, start: number, duration = effectSeconds[kind]): VideoClip {
  return { id: uid(), track, kind: "effect", src: "", name: effectNames[kind], in: 0, out: Math.max(minSeconds, duration), start: Math.max(0, start), effect: cleanEffect({ kind })! };
}

/** 特效所在轨：`start` 到 `end` 有空位的最上层非磁性视频轨；null 表示需要新建。 */
export function effectTrackFor(doc: VideoDoc, start: number, end: number, places = placeAll(doc)): VideoTrack | null {
  for (const track of doc.tracks.filter(item => item.kind === "video" && !item.magnetic && !item.locked)) {
    const busy = doc.clips.some(clip => clip.track === track.id && places.get(clip.id)!.start < end - 1e-6 && places.get(clip.id)!.end > start + 1e-6);
    if (!busy) return track;
  }
  return null;
}

/** 在所有视频轨之上新建 FX1、FX2… 特效轨。 */
export function addEffectTrack(doc: VideoDoc): { doc: VideoDoc; track: VideoTrack } {
  const { doc: next, track } = addTrack(doc, "video");
  const count = doc.tracks.filter(item => /^FX\d+$/.test(item.name)).length + 1;
  const named = { ...track, name: `FX${count}` };
  return { doc: { ...next, tracks: next.tracks.map(item => (item.id === track.id ? named : item)) }, track: named };
}

/** 特效内经过的秒数及总长。 */
const local = (place: Place, time: number) => ({ tau: time - place.start, D: Math.max(1e-6, place.end - place.start) });
const fullTurn = 2 * Math.PI;

// 抖动：每轴两条正弦叠加的位移，并放大以免露出边缘。
/** 强度为 1 时的最大位移（画面比例）。 */
export const shakeMax = 0.04;
/** 权重、频率（Hz）、相位。 */
export const shakeWaves = { x: [[0.6, 7.3, 0], [0.4, 13.1, 1.3]], y: [[0.6, 8.7, 0.7], [0.4, 11.9, 2.1]] } as const;
export function shakeAt(effect: VideoEffect, place: Place, time: number): { dx: number; dy: number; zoom: number } {
  const { tau } = local(place, time);
  const amplitude = effect.amount * shakeMax;
  const wave = (waves: readonly (readonly [number, number, number])[]) => waves.reduce((sum, [weight, frequency, phase]) => sum + weight * Math.sin(fullTurn * frequency * tau + phase), 0);
  return { dx: amplitude * wave(shakeWaves.x), dy: amplitude * wave(shakeWaves.y), zoom: 1 + 2 * amplitude };
}

// 闪光：前 flashRise 比例内升起，随后淡出至结束。
export const flashRise = 0.15;
export function flashAlpha(effect: VideoEffect, place: Place, time: number): number {
  const { tau, D } = local(place, time);
  if (tau < 0 || tau > D) return 0;
  const rise = flashRise * D;
  return effect.amount * (tau < rise ? tau / rise : (D - tau) / (D - rise));
}

/** 平滑叠加层（暗角、漏光）先在低分辨率网格计算，再拉伸到画面。 */
export const fxGridWidth = 128;
export const fxGrid = (doc: Pick<VideoDoc, "width" | "height">) => ({ w: fxGridWidth, h: Math.max(8, Math.round((fxGridWidth * doc.height) / doc.width)) });

// 暗角：黑色，透明度随到中心的距离增长（u、v 为画面比例）。
export const vignetteMax = 0.85;
/** 从中心到角落的多少比例开始变暗。 */
export const vignetteInner = 0.35;
export function vignetteAlpha(amount: number, u: number, v: number): number {
  const radius = Math.hypot(u - 0.5, v - 0.5) / Math.hypot(0.5, 0.5);
  const k = clamp((radius - vignetteInner) / (1 - vignetteInner), 0, 1);
  return amount * vignetteMax * k * k;
}

// 颗粒：±grainMax 级（共 255 级）的均匀噪点，网格为画面一半，以 overlay 混合。
export const grainMax = 60;

// 老电影：棕褐色、颗粒、暗角与闪烁（透明度波动的黑色遮罩）。
export const oldFilmLook = { sepia: 0.6, grain: 0.5, vignette: 0.7, flicker: 0.12 };
export function flickerAlpha(amount: number, place: Place, time: number): number {
  const { tau } = local(place, time);
  return amount * oldFilmLook.flicker * (0.5 + 0.5 * Math.sin(fullTurn * 9 * tau) * Math.sin(fullTurn * 2.3 * tau + 1));
}

// 故障：三条正弦之和超过 glitchOn 时爆发，红蓝通道分离并横向抖动。
/** 频率（Hz）、相位。 */
export const glitchWaves = [[1.7, 0], [4.3, 1.1], [9.1, 2.3]] as const;
export const glitchOn = 0.8;
/** 强度为 1 时的通道分离（画面宽度比例）。 */
export const glitchSplit = 0.015;
export const glitchJolt = 0.03;
export const glitchJoltHz = 17;
export function glitchAt(effect: VideoEffect, place: Place, time: number): { on: boolean; split: number; jolt: number } {
  const { tau } = local(place, time);
  const on = !!effect.steady || glitchWaves.reduce((sum, [frequency, phase]) => sum + Math.sin(fullTurn * frequency * tau + phase), 0) > glitchOn;
  return { on, split: effect.amount * glitchSplit, jolt: on ? effect.amount * glitchJolt * Math.sin(fullTurn * glitchJoltHz * tau) : 0 };
}

// 漏光：两团 `color` 柔光横向漂移，按 sin(πk) 膨胀消退，以 screen 叠加。
/** x：起点与位移；y：中心与摆动（整个特效内一个正弦周期）。 */
export const leakBlobs = [
  { weight: 1, sigma: 0.35, x: [-0.1, 1.2], y: [0.25, 0.15] },
  { weight: 0.6, sigma: 0.25, x: [1.1, -1.0], y: [0.8, 0] },
] as const;
export function leakLevel(amount: number, place: Place, time: number, u: number, v: number): number {
  const { tau, D } = local(place, time);
  const k = clamp(tau / D, 0, 1);
  let level = 0;
  for (const blob of leakBlobs) {
    const cx = blob.x[0] + blob.x[1] * k;
    const cy = blob.y[0] + blob.y[1] * Math.sin(fullTurn * k);
    level += blob.weight * Math.exp(-((u - cx) ** 2 + (v - cy) ** 2) / (2 * blob.sigma * blob.sigma));
  }
  return Math.min(1, amount * Math.sin(Math.PI * k) * level);
}

// 方向模糊：沿单轴的高斯模糊，强度为 1 时标准差 dirBlurMax 像素。
export const dirBlurMax = 40;

// 缩放（转场内）：特效中点放大到 1 + zoomMax × amount 后缩回。
export const zoomMax = 0.5;
export function zoomAt(effect: VideoEffect, place: Place, time: number): number {
  const { tau, D } = local(place, time);
  return 1 + effect.amount * zoomMax * Math.sin(Math.PI * clamp(tau / D, 0, 1));
}

// 旋转（转场内）：中点前转到 spinMax × amount 度，中点跳到反向同角度（切点在此）后缓动回正，并放大到恰好覆盖画面。
export const spinMax = 90;
export function spinAt(effect: VideoEffect, place: Place, time: number, doc: Pick<VideoDoc, "width" | "height">): { angle: number; zoom: number } {
  const { tau, D } = local(place, time);
  const k = smooth(clamp(tau / D, 0, 1));
  const angle = 2 * spinMax * effect.amount * (k - (k >= 0.5 ? 1 : 0));
  const radians = (Math.abs(angle) * Math.PI) / 180;
  return { angle, zoom: Math.cos(radians) + Math.sin(radians) * Math.max(doc.width / doc.height, doc.height / doc.width) };
}

// ---- 转场（磁性轨相邻片段之间）----
//
// 五种风格。fade：新片段淡入盖住旧片段。dip：旧片段闪到某色，新片段从中出现。cut：中点硬切，由闪光、缩放、旋转、故障或眨眼掩盖。
// reveal：移动边缘揭开新片段（擦除、圆形）。move：新片段移入（推、滑、甩镜，推与甩镜同时移出旧片段）。
// 部分转场还会在磁性轨上叠加特效，预览与导出都按特效片段处理。

export const transitionKinds: VideoTransitionKind[] = ["dissolve", "dipBlack", "dipWhite", "flash", "leak", "blink", "whip", "push", "slide", "wipe", "circle", "zoom", "spin", "glitch"];
export const transitionNames: Record<VideoTransitionKind, string> = {
  dissolve: "交叉叠化", dipBlack: "闪黑", dipWhite: "闪白", flash: "闪光（回忆）", leak: "漏光", blink: "眨眼（醒来）",
  whip: "甩镜", push: "推入", slide: "滑入", wipe: "擦除", circle: "圆形展开", zoom: "缩放", spin: "旋转", glitch: "故障",
};
/** 新转场的时长。 */
export const transitionSeconds: Record<VideoTransitionKind, number> = {
  dissolve: 0.5, dipBlack: 0.6, dipWhite: 0.6, flash: 0.6, leak: 1, blink: 1, whip: 0.35, push: 0.5, slide: 0.5, wipe: 0.6, circle: 0.7, zoom: 0.5, spin: 0.6, glitch: 0.5,
};
/** 有方向的转场。 */
export const transitionDirected: VideoTransitionKind[] = ["whip", "push", "slide", "wipe"];
export const directions: VideoDirection[] = ["left", "right", "up", "down"];

export type TransitionStyle = "fade" | "dip" | "cut" | "reveal" | "move";
const transitionStyles: Record<VideoTransitionKind, TransitionStyle> = {
  dissolve: "fade", leak: "fade", dipBlack: "dip", dipWhite: "dip", flash: "cut", zoom: "cut", spin: "cut", glitch: "cut", blink: "cut",
  wipe: "reveal", circle: "reveal", push: "move", slide: "move", whip: "move",
};
export const transitionStyle = (kind: VideoTransitionKind): TransitionStyle => transitionStyles[kind] ?? "fade";

/** 规范化存储的转场：未知类型按叠化处理，时长为正，有方向的类型带方向。 */
export function cleanTransition(raw: unknown): VideoClip["transition"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const kind = transitionKinds.includes(value.kind as VideoTransitionKind) ? (value.kind as VideoTransitionKind) : "dissolve";
  const duration = num(value.duration, transitionSeconds[kind]);
  if (duration <= 0) return undefined;
  const direction = directions.includes(value.direction as VideoDirection) ? (value.direction as VideoDirection) : "left";
  return { kind, duration, ...(transitionDirected.includes(kind) && { direction }) };
}

/** Smoothstep：慢—快—慢，导出写作 k*k*(3-2*k)。 */
export const smooth = (k: number) => k * k * (3 - 2 * k);
export const directionVector: Record<VideoDirection, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/** 移动类转场在 `time` 的位移（画面比例）：移入时从整屏外移到位，推入与甩镜移出时再移走一屏，均为平滑缓动。 */
export function transitionShift(place: Place, time: number): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  if (place.into && transitionStyle(place.into.kind) === "move") {
    const [vx, vy] = directionVector[place.into.dir ?? "left"];
    const left = 1 - smooth(clamp((time - place.start) / place.into.d, 0, 1));
    dx -= vx * left;
    dy -= vy * left;
  }
  if (place.outOf && (place.outOf.kind === "push" || place.outOf.kind === "whip")) {
    const [vx, vy] = directionVector[place.outOf.dir ?? "left"];
    const gone = smooth(clamp((time - (place.end - place.outOf.d)) / place.outOf.d, 0, 1));
    dx += vx * gone;
    dy += vy * gone;
  }
  return { dx, dy };
}

// 揭开：柔边宽度，擦除为画框宽高比例，圆形为画框短边比例。
export const wipeFeather = 0.08;
export const circleFeather = 0.05;
export type Reveal = { kind: "wipe"; dir: VideoDirection; e: number } | { kind: "circle"; e: number };

/** `time` 时进入片段的揭开转场（e 为缓动后的进度），没有时为 null。 */
export function revealAt(place: Place, time: number): Reveal | null {
  if (!place.into || transitionStyle(place.into.kind) !== "reveal" || time >= place.start + place.into.d) return null;
  const e = smooth(clamp((time - place.start) / place.into.d, 0, 1));
  return place.into.kind === "circle" ? { kind: "circle", e } : { kind: "wipe", dir: place.into.dir ?? "left", e };
}

/** 画框内某点显示多少（u、v 为比例，w、h 为画框像素）。擦除边缘沿 `dir` 方向移动，圆形从中心扩大。 */
export function revealAlpha(reveal: Reveal, u: number, v: number, w: number, h: number): number {
  if (reveal.kind === "circle") {
    const feather = circleFeather * Math.min(w, h);
    const radius = reveal.e * (Math.hypot(w, h) / 2 + feather);
    return clamp((radius - Math.hypot((u - 0.5) * w, (v - 0.5) * h)) / feather, 0, 1);
  }
  const along = reveal.dir === "right" ? u : reveal.dir === "left" ? 1 - u : reveal.dir === "down" ? v : 1 - v;
  return clamp((reveal.e * (1 + wipeFeather) - along) / wipeFeather, 0, 1);
}

/** 磁性轨转场附带的特效（不存储的特效片段）及其位置；部分转场的模糊以调整图层的 `blur` 表示（画面宽度比例）。 */
export function transitionEffects(doc: VideoDoc, places = placeAll(doc)): { c: VideoClip; p: Place }[] {
  const magneticId = magneticTrack(doc)?.id;
  const effects: { c: VideoClip; p: Place }[] = [];
  for (const clip of doc.clips) {
    const place = places.get(clip.id);
    if (clip.track !== magneticId || !place?.into) continue;
    const { kind, d } = place.into;
    const start = place.start;
    const middle = start + d / 2;
    const add = (from: number, to: number, effect: VideoEffect | null, blur?: number) =>
      effects.push({
        c: { id: `tx-${clip.id}-${effects.length}`, track: clip.track, kind: "effect", src: "", name: transitionNames[kind], in: 0, out: to - from, effect: effect ?? { kind: "adjust", amount: 1 }, ...(blur && { blur: Math.round(blur * doc.width) }) },
        p: { start: from, end: to },
      });
    // 在 `at` 达到峰值的闪光：前 flashRise 比例升起，随后回落。
    const flash = (at: number, length: number, color: string, amount = 1) => add(at - flashRise * length, at + (1 - flashRise) * length, { kind: "flash", amount, color });
    if (kind === "flash") {
      flash(middle, d, "#ffffff");
      add(middle - 0.25 * d, middle + 0.3 * d, null, 0.01);
    } else if (kind === "leak") add(start, start + d, { kind: "lightLeak", amount: 1, color: "#ff9a3c" });
    else if (kind === "whip") add(start + 0.15 * d, start + 0.85 * d, { kind: "dirBlur", amount: 1, direction: place.into.dir === "up" || place.into.dir === "down" ? "vertical" : "horizontal" });
    else if (kind === "blink") {
      flash(middle, 0.45 * d, "#000000");
      flash(middle + 0.38 * d, 0.25 * d, "#000000", 0.9);
      add(middle, middle + 0.45 * d, null, 0.006);
    } else if (kind === "zoom" || kind === "spin") {
      add(start, start + d, { kind, amount: 1 });
      add(middle - 0.2 * d, middle + 0.2 * d, null, 0.008);
    } else if (kind === "glitch") add(start, start + d, { kind: "glitch", amount: 0.8, steady: true });
  }
  return effects;
}
