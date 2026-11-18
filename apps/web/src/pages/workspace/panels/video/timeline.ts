// 时间线编辑操作：鼠标与快捷键背后的纯函数。位置与外观规则在 videoModel.ts。

import type { VideoClip, VideoDoc, VideoText, VideoTrack } from "./types";
import { addTrack, boxSize, clipLength, fitsTrack, isStill, magneticTrack, minSeconds, placeAll, shiftKeys, splitItems, subtitleStyle, uid, type Place } from "./videoModel";

export * from "./videoModel";

/** 时间线上的一项：片段或文字，带位置与所在轨道。 */
export type Item =
  | { kind: "clip"; clip: VideoClip; track: VideoTrack; start: number; end: number }
  | { kind: "text"; text: VideoText; track: VideoTrack; start: number; end: number };

export function itemOf(doc: VideoDoc, places: Map<string, Place>, id: string): Item | null {
  const clip = doc.clips.find(item => item.id === id);
  if (clip) {
    const place = places.get(clip.id)!;
    return { kind: "clip", clip, track: doc.tracks.find(track => track.id === clip.track)!, start: place.start, end: place.end };
  }
  const text = doc.texts.find(item => item.id === id);
  return text ? { kind: "text", text, track: doc.tracks.find(track => track.id === text.track)!, start: text.start, end: text.start + text.duration } : null;
}

export const fits = fitsTrack;

export function remove(doc: VideoDoc, ids: string[]): VideoDoc {
  const gone = new Set(ids);
  return { ...doc, clips: doc.clips.filter(clip => !gone.has(clip.id)), texts: doc.texts.filter(text => !gone.has(text.id)), markers: doc.markers.filter(marker => !gone.has(marker.id)) };
}

/** 修改片段字段；补丁中的 `undefined` 表示删除该字段。 */
export function patchClips(doc: VideoDoc, ids: string[], patch: Partial<VideoClip> | ((clip: VideoClip) => Partial<VideoClip>)): VideoDoc {
  return {
    ...doc,
    clips: doc.clips.map(clip => {
      if (!ids.includes(clip.id)) return clip;
      const next = { ...clip, ...(typeof patch === "function" ? patch(clip) : patch) } as VideoClip;
      for (const key of Object.keys(next) as (keyof VideoClip)[]) if (next[key] === undefined) delete next[key];
      return next;
    }),
  };
}

export function patchTexts(doc: VideoDoc, ids: string[], patch: (text: VideoText) => Partial<VideoText>): VideoDoc {
  return {
    ...doc,
    texts: doc.texts.map(text => {
      if (!ids.includes(text.id)) return text;
      const next = { ...text, ...patch(text) } as VideoText;
      for (const key of Object.keys(next) as (keyof VideoText)[]) if (next[key] === undefined) delete next[key];
      return next;
    }),
  };
}

export const patchTracks = (doc: VideoDoc, id: string, patch: Partial<VideoTrack>): VideoDoc => ({
  ...doc,
  tracks: doc.tracks.map(track => {
    if (track.id !== id) return track;
    const next = { ...track, ...patch };
    for (const key of Object.keys(next) as (keyof VideoTrack)[]) if (next[key] === undefined) delete next[key];
    return next;
  }),
});

/** 片段拖放到时间 `t` 时在磁性轨中的序号（`skip`：正在拖动的片段）。 */
export function insertIndex(doc: VideoDoc, t: number, skip?: string): number {
  const magneticId = magneticTrack(doc).id;
  let at = 0;
  let index = 0;
  for (const clip of doc.clips) {
    if (clip.track !== magneticId || clip.id === skip) continue;
    const length = clipLength(clip);
    if (t > at + length / 2) index++;
    at += length;
  }
  return index;
}

/** 把片段放到轨道上：磁性轨按序号 `index`，其他轨按 `start`。转场只在磁性轨有意义。 */
export function placeClip(doc: VideoDoc, id: string, trackId: string, at: { index?: number; start?: number }): VideoDoc {
  const clip = doc.clips.find(item => item.id === id);
  const track = doc.tracks.find(item => item.id === trackId);
  if (!clip || !track || !fits(clip, track)) return doc;
  const rest = doc.clips.filter(item => item.id !== id);
  if (track.magnetic) {
    const { start: _start, ...moved } = { ...clip, track: trackId };
    const onTrack = rest.filter(item => item.track === trackId);
    const before = onTrack[at.index ?? onTrack.length];
    const position = before ? rest.indexOf(before) : rest.length;
    return { ...doc, clips: [...rest.slice(0, position), moved, ...rest.slice(position)] };
  }
  const { transition: _transition, ...moved } = { ...clip, track: trackId, start: Math.max(0, at.start ?? 0) };
  return { ...doc, clips: [...rest, moved] };
}

/** 按 `delta` 秒裁剪片段或文字的一端（正值向后）。磁性轨裁剪会带动后续片段，其他轨对端不动。 */
export function trim(doc: VideoDoc, id: string, edge: "start" | "end", delta: number): VideoDoc {
  const text = doc.texts.find(item => item.id === id);
  if (text) {
    if (edge === "end") return patchTexts(doc, [id], () => ({ duration: Math.max(minSeconds, text.duration + delta) }));
    const d = Math.min(Math.max(delta, -text.start), text.duration - minSeconds);
    return patchTexts(doc, [id], () => ({ start: text.start + d, duration: text.duration - d }));
  }
  const clip = doc.clips.find(item => item.id === id);
  if (!clip) return doc;
  const free = !doc.tracks.find(track => track.id === clip.track)?.magnetic;
  const length = clipLength(clip);
  if (isStill(clip)) {
    if (edge === "end") return patchClips(doc, [id], { in: 0, out: Math.max(minSeconds, length + delta) });
    const d = Math.min(delta, length - minSeconds);
    const shift = free ? Math.max(d, -(clip.start ?? 0)) : d;
    return patchClips(doc, [id], { in: 0, out: length - shift, ...(free && { start: (clip.start ?? 0) + shift }), keys: shiftKeys(clip.keys, shift) });
  }
  const speed = clip.speed ?? 1;
  const max = clip.srcDuration ?? Infinity;
  if (edge === "end") return patchClips(doc, [id], { out: Math.min(max, Math.max(clip.in + minSeconds * speed, clip.out + delta * speed)) });
  let d = Math.min(Math.max(delta, -clip.in / speed), length - minSeconds);
  if (free) d = Math.max(d, -(clip.start ?? 0));
  // 关键帧保持在原先设置的画面上。
  return patchClips(doc, [id], { in: clip.in + d * speed, ...(free && { start: (clip.start ?? 0) + d }), keys: shiftKeys(clip.keys, d) });
}

/** 未锁定轨道上 `t` 严格位于其内部的片段与文字。 */
export function itemsAcross(doc: VideoDoc, t: number, places = placeAll(doc)): string[] {
  const open = new Set(doc.tracks.filter(track => !track.locked).map(track => track.id));
  const inside = (a: number, b: number) => t > a + minSeconds / 2 && t < b - minSeconds / 2;
  return [
    ...doc.clips.filter(clip => open.has(clip.track) && inside(places.get(clip.id)!.start, places.get(clip.id)!.end)).map(clip => clip.id),
    ...doc.texts.filter(text => open.has(text.track) && inside(text.start, text.start + text.duration)).map(text => text.id),
  ];
}

/**
 * Premiere 的提升（`ripple` 为 false）与提取（true）：在所有未锁定轨道上移除 [a, b]，跨边缘的在边缘处切开。
 * 提取还会把自由轨上 `b` 之后的内容前移 `b − a`；磁性轨本身没有空隙。`skip`：视为锁定的轨道。
 */
export function removeRange(doc: VideoDoc, a: number, b: number, ripple: boolean, skip?: string): VideoDoc {
  if (b - a < minSeconds / 2) return doc;
  const trackOfItem = (value: VideoDoc, id: string) => value.clips.find(clip => clip.id === id)?.track ?? value.texts.find(text => text.id === id)?.track;
  const across = (value: VideoDoc, t: number) => itemsAcross(value, t).filter(id => trackOfItem(value, id) !== skip);
  let next = splitItems(doc, across(doc, a), a).doc;
  next = splitItems(next, across(next, b), b).doc;
  const places = placeAll(next);
  const open = new Set(next.tracks.filter(track => !track.locked && track.id !== skip).map(track => track.id));
  const within = (start: number, end: number) => start >= a - 1e-3 && end <= b + 1e-3;
  const gone = [
    ...next.clips.filter(clip => open.has(clip.track) && within(places.get(clip.id)!.start, places.get(clip.id)!.end)).map(clip => clip.id),
    ...next.texts.filter(text => open.has(text.track) && within(text.start, text.start + text.duration)).map(text => text.id),
  ];
  next = remove(next, gone);
  if (!ripple) return next;
  const magneticId = magneticTrack(next).id;
  const shift = (start: number) => (start >= b - 1e-3 ? Math.max(0, start - (b - a)) : start);
  return {
    ...next,
    clips: next.clips.map(clip => (clip.track !== magneticId && open.has(clip.track) && clip.start !== undefined ? { ...clip, start: shift(clip.start) } : clip)),
    texts: next.texts.map(text => (open.has(text.track) ? { ...text, start: shift(text.start) } : text)),
    markers: next.markers.filter(marker => marker.time < a || marker.time >= b).map(marker => ({ ...marker, time: shift(marker.time) })),
  };
}

/** 波纹删除：删除后把自由轨上其后的内容按各自长度前移，不留空隙（磁性轨本身会合拢）。 */
export function rippleDelete(doc: VideoDoc, ids: string[]): VideoDoc {
  const places = placeAll(doc);
  const magneticId = magneticTrack(doc).id;
  const holes = new Map<string, { start: number; length: number }[]>();
  const note = (track: string, start: number, end: number) => holes.set(track, [...(holes.get(track) ?? []), { start, length: end - start }]);
  for (const clip of doc.clips) if (ids.includes(clip.id) && clip.track !== magneticId) note(clip.track, places.get(clip.id)!.start, places.get(clip.id)!.end);
  for (const text of doc.texts) if (ids.includes(text.id)) note(text.track, text.start, text.start + text.duration);
  const next = remove(doc, ids);
  const pull = (track: string, start: number) => start - (holes.get(track) ?? []).filter(hole => hole.start + hole.length <= start + 1e-3).reduce((sum, hole) => sum + hole.length, 0);
  return {
    ...next,
    clips: next.clips.map(clip => (clip.track !== magneticId && holes.has(clip.track) && clip.start !== undefined ? { ...clip, start: Math.max(0, pull(clip.track, clip.start)) } : clip)),
    texts: next.texts.map(text => (holes.has(text.track) ? { ...text, start: Math.max(0, pull(text.track, text.start)) } : text)),
  };
}

/**
 * 保持各轨与磁性轨同步的删除：删除磁性轨片段时不留空隙，其下其他未锁定轨道上的内容一并切除，之后的内容同步前移。
 * 不涉及磁性轨片段时为普通删除（`ripple` 时为波纹删除）。锁定轨道不动。
 */
export function syncDelete(doc: VideoDoc, ids: string[], ripple: boolean): VideoDoc {
  const magneticId = magneticTrack(doc).id;
  const onMagnetic = (value: VideoDoc) => value.clips.filter(clip => clip.track === magneticId);
  const gone = onMagnetic(doc).filter(clip => ids.includes(clip.id));
  if (!gone.length) return ripple ? rippleDelete(doc, ids) : remove(doc, ids);
  let next = remove(doc, ids.filter(id => !gone.some(clip => clip.id === id)));
  // 从后往前逐个处理，前面的位置保持不变；其他轨移动的距离与后一片段实际前移的距离相同（转场重叠会使其小于片段长度）。
  const original = placeAll(doc);
  for (const clip of [...gone].sort((p, q) => original.get(q.id)!.start - original.get(p.id)!.start)) {
    const before = placeAll(next);
    const row = onMagnetic(next);
    const index = row.findIndex(item => item.id === clip.id);
    const place = before.get(clip.id)!;
    const after = row[index + 1];
    next = remove(next, [clip.id]);
    if (after) {
      const from = before.get(after.id)!.start;
      const to = placeAll(next).get(after.id)!.start;
      next = removeRange(next, to, from, true, magneticId);
    } else {
      next = removeRange(next, Math.max(place.start, index > 0 ? before.get(row[index - 1]!.id)!.end : 0), place.end, true, magneticId);
    }
  }
  return next;
}

/** 自由轨上 `t` 周围的空隙；有内容时为 null。 */
export function gapAt(doc: VideoDoc, trackId: string, t: number): { start: number; end: number } | null {
  const places = placeAll(doc);
  const spans = [
    ...doc.clips.filter(clip => clip.track === trackId).map(clip => places.get(clip.id)!),
    ...doc.texts.filter(text => text.track === trackId).map(text => ({ start: text.start, end: text.start + text.duration })),
  ];
  if (spans.some(span => t >= span.start && t < span.end)) return null;
  const start = Math.max(0, ...spans.filter(span => span.end <= t).map(span => span.end));
  const after = spans.filter(span => span.start > t).map(span => span.start);
  return after.length ? { start, end: Math.min(...after) } : null;
}

/** 合拢自由轨上 `at` 所在的空隙，或全部空隙：其后内容前移。 */
export function closeGaps(doc: VideoDoc, trackId: string, at?: number): VideoDoc {
  const track = doc.tracks.find(item => item.id === trackId);
  if (!track || track.magnetic) return doc;
  const places = placeAll(doc);
  type Span = { id: string; start: number; end: number };
  const spans: Span[] = [
    ...doc.clips.filter(clip => clip.track === trackId).map(clip => ({ id: clip.id, ...places.get(clip.id)! })),
    ...doc.texts.filter(text => text.track === trackId).map(text => ({ id: text.id, start: text.start, end: text.start + text.duration })),
  ].sort((p, q) => p.start - q.start);
  const moved = new Map<string, number>();
  if (at !== undefined) {
    const gap = gapAt(doc, trackId, at);
    if (!gap) return doc;
    for (const span of spans) if (span.start >= gap.end - 1e-3) moved.set(span.id, span.start - (gap.end - gap.start));
  } else {
    let end = spans[0]?.start ?? 0;
    for (const span of spans) {
      const start = Math.min(span.start, end);
      if (start < span.start - 1e-3) moved.set(span.id, start);
      end = Math.max(end, start + (span.end - span.start));
    }
  }
  if (!moved.size) return doc;
  return {
    ...doc,
    clips: doc.clips.map(clip => (moved.has(clip.id) ? { ...clip, start: moved.get(clip.id)! } : clip)),
    texts: doc.texts.map(text => (moved.has(text.id) ? { ...text, start: moved.get(text.id)! } : text)),
  };
}

/** [start, end) 内为空的第一条同类未锁定轨道。 */
export function freeTrackAt(doc: VideoDoc, kind: VideoTrack["kind"], start: number, end: number): VideoTrack | undefined {
  const places = placeAll(doc);
  return doc.tracks.find(track => track.kind === kind && !track.locked && !track.magnetic && !doc.clips.some(clip => {
    if (clip.track !== track.id) return false;
    const place = places.get(clip.id)!;
    return place.start < end && place.end > start;
  }) && !doc.texts.some(text => text.track === track.id && text.start < end && text.start + text.duration > start));
}

/** `threshold` 内离 `t` 最近的吸附点，否则保持 `t`。 */
export function snap(t: number, points: number[], threshold: number): { t: number; to: number | null } {
  let best: number | null = null;
  for (const point of points) if (Math.abs(point - t) <= threshold && (best === null || Math.abs(point - t) < Math.abs(best - t))) best = point;
  return best === null ? { t, to: null } : { t: best, to: best };
}

/** 吸附点：0、播放头、标记，以及时间线上除正在移动项之外的所有边缘。 */
export function snapPoints(doc: VideoDoc, places: Map<string, Place>, playhead: number, except: Set<string>): number[] {
  const points = [0, playhead, ...doc.markers.map(marker => marker.time)];
  for (const clip of doc.clips) if (!except.has(clip.id)) points.push(places.get(clip.id)!.start, places.get(clip.id)!.end);
  for (const text of doc.texts) if (!except.has(text.id)) points.push(text.start, text.start + text.duration);
  return points;
}

/** 在原项之后复制片段与文字（磁性轨上紧随其后），返回副本 id。 */
export function duplicate(doc: VideoDoc, ids: string[]): { doc: VideoDoc; made: string[] } {
  const places = placeAll(doc);
  const made: string[] = [];
  const clips: VideoClip[] = [];
  const magneticId = magneticTrack(doc).id;
  for (const clip of doc.clips) {
    clips.push(clip);
    if (!ids.includes(clip.id)) continue;
    const copy = { ...clip, id: uid(), ...(clip.track !== magneticId && { start: places.get(clip.id)!.end }) };
    clips.push(copy);
    made.push(copy.id);
  }
  const texts = [...doc.texts];
  for (const text of doc.texts) {
    if (!ids.includes(text.id)) continue;
    const copy = { ...text, id: uid(), start: text.start + text.duration };
    texts.push(copy);
    made.push(copy.id);
  }
  return { doc: { ...doc, clips, texts }, made };
}

/** 复制内容：片段与文字，时间相对其中最早的一项。 */
export interface Clipboard { clips: (VideoClip & { at: number })[]; texts: (VideoText & { at: number })[] }

export function copyItems(doc: VideoDoc, ids: string[]): Clipboard | null {
  const places = placeAll(doc);
  const clips = doc.clips.filter(clip => ids.includes(clip.id));
  const texts = doc.texts.filter(text => ids.includes(text.id));
  if (!clips.length && !texts.length) return null;
  const first = Math.min(...clips.map(clip => places.get(clip.id)!.start), ...texts.map(text => text.start));
  return { clips: clips.map(clip => ({ ...clip, at: places.get(clip.id)!.start - first })), texts: texts.map(text => ({ ...text, at: text.start - first })) };
}

/** 在 `t` 粘贴：原轨道仍在就放回原轨，否则放到第一条合适的轨道；磁性轨片段插入播放头处。 */
export function pasteItems(doc: VideoDoc, clipboard: Clipboard, t: number): { doc: VideoDoc; made: string[] } {
  let next = doc;
  const made: string[] = [];
  const index = insertIndex(doc, t);
  let offset = 0;
  for (const { at, ...clip } of clipboard.clips) {
    const track = doc.tracks.find(item => item.id === clip.track && fits(clip, item)) ?? doc.tracks.find(item => fits(clip, item));
    if (!track) continue;
    const copy = { ...clip, id: uid(), track: track.id };
    next = { ...next, clips: [...next.clips, copy] };
    next = placeClip(next, copy.id, track.id, track.magnetic ? { index: index + offset++ } : { start: t + at });
    made.push(copy.id);
  }
  for (const { at, ...text } of clipboard.texts) {
    const track = doc.tracks.find(item => item.id === text.track) ?? doc.tracks.find(item => item.kind === "text");
    if (!track) continue;
    const copy = { ...text, id: uid(), track: track.id, start: t + at };
    next = { ...next, texts: [...next.texts, copy] };
    made.push(copy.id);
  }
  return { doc: next, made };
}

/** 分离音频：视频片段的声音成为音频轨上的独立片段，原视频静音。 */
export function detachAudio(doc: VideoDoc, id: string): { doc: VideoDoc; made: string | null } {
  const clip = doc.clips.find(item => item.id === id);
  if (!clip || clip.kind !== "video") return { doc, made: null };
  const place = placeAll(doc).get(id)!;
  let next = doc;
  let audio = freeTrackAt(doc, "audio", place.start, place.end);
  if (!audio) ({ doc: next, track: audio } = addTrack(doc, "audio"));
  const sound: VideoClip = {
    id: uid(), track: audio.id, kind: "video", src: clip.src, name: `${clip.name}（音频）`, in: clip.in, out: clip.out, start: place.start,
    ...(clip.srcDuration && { srcDuration: clip.srcDuration }), ...(clip.speed && { speed: clip.speed }), ...(clip.volume !== undefined && { volume: clip.volume }),
    ...(clip.audioFadeIn && { audioFadeIn: clip.audioFadeIn }), ...(clip.audioFadeOut && { audioFadeOut: clip.audioFadeOut }),
  };
  const quiet = patchClips(next, [id], { muted: true });
  return { doc: { ...quiet, clips: [...quiet.clips, sound] }, made: sound.id };
}

/** 把片段做成老照片：缩小、加白边、叠在自身的模糊副本上，并在角落写上日期（放在当时空闲的文字轨，没有则新建）。 */
export function asPhoto(doc: VideoDoc, id: string, now = new Date()): { doc: VideoDoc; made: string[] } {
  const clip = doc.clips.find(item => item.id === id);
  if (!clip || clip.kind === "audio" || clip.kind === "effect") return { doc, made: [] };
  const place = placeAll(doc).get(id)!;
  const scale = 0.78;
  let next = patchClips(doc, [id], { fit: "blur", scale, border: { width: 0.035, color: "#ffffff" } });
  const { w, h } = boxSize(doc, { ...clip, fit: "blur", scale }, scale);
  let track = freeTrackAt(next, "text", place.start, place.end);
  if (!track) {
    const added = addTrack(next, "text");
    track = added.track;
    next = added.doc;
  }
  const date: VideoText = {
    id: uid(), track: track.id, text: `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`, start: place.start, duration: place.end - place.start,
    style: {
      ...subtitleStyle, font: "KaiTi", size: 3.4, bold: false, italic: true, color: "#3a3a3a", strokeWidth: 0, shadow: false, align: "center",
      x: (clip.x ?? 0.5) + (0.36 * w) / doc.width, y: (clip.y ?? 0.5) + (0.42 * h) / doc.height,
    },
  };
  return { doc: { ...next, texts: [...next.texts, date] }, made: [date.id] };
}

/** 83.4 → "1:23.12"（分、秒、帧）。 */
export function timecode(t: number, fps: number): string {
  const whole = Math.max(0, t + 1e-6);
  const minutes = Math.floor(whole / 60);
  const seconds = Math.floor(whole % 60);
  const frames = Math.floor((whole % 1) * fps);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(frames).padStart(2, "0")}`;
}

/** 时:分:秒:帧（00:00:04:12）。 */
export function smpte(t: number, fps: number): string {
  const frames = Math.max(0, Math.round(t * fps));
  const rate = Math.round(fps);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(frames / (rate * 3600)))}:${pad(Math.floor(frames / (rate * 60)) % 60)}:${pad(Math.floor(frames / rate) % 60)}:${pad(frames % rate)}`;
}

/** 每 `step` 秒一个刻度、每 `label` 秒一个标签，使标签在每秒 `pps` 像素时至少相隔约 80px。 */
export function rulerSteps(pps: number): { step: number; label: number } {
  const labels = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const label = labels.find(value => value * pps >= 80) ?? 600;
  return { step: label <= 10 ? label / 5 : label / 6, label };
}

export const framePresets: { label: string; width: number; height: number }[] = [
  { label: "9:16 竖屏 · 1080×1920", width: 1080, height: 1920 },
  { label: "9:16 竖屏 · 720×1280", width: 720, height: 1280 },
  { label: "16:9 横屏 · 1920×1080", width: 1920, height: 1080 },
  { label: "16:9 横屏 · 1280×720", width: 1280, height: 720 },
  { label: "1:1 方形 · 1080×1080", width: 1080, height: 1080 },
  { label: "4:5 竖版 · 1080×1350", width: 1080, height: 1350 },
  { label: "3:4 竖版 · 1080×1440", width: 1080, height: 1440 },
];

const videoExtensions = new Set(["mp4", "webm", "mov", "m4v", "ogv", "mkv"]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);
const audioExtensions = new Set(["mp3", "wav", "ogg", "oga", "opus", "m4a", "flac", "aac"]);
export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");
export const mediaKind = (name: string): VideoClip["kind"] | null =>
  videoExtensions.has(extOf(name)) ? "video" : imageExtensions.has(extOf(name)) ? "image" : audioExtensions.has(extOf(name)) ? "audio" : null;
export const fileName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
