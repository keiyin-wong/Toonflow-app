// 源监视器的编辑：把文件标记的区间放到轨道上，即 Premiere 的插入与覆盖。

import type { VideoClip, VideoDoc } from "./types";
import { clipLength, minSeconds, placeAll, placeClip, remove, splitItems } from "./timeline";

const edgeEps = 1e-3;

/** 源监视器拖动手柄传递的数据类型（文件路径；入出点由页面保存）。 */
export const sourceDragType = "application/x-toonflow-video-source";
/** 素材面板拖动文件到轨道的数据类型（工作区相对路径数组）。 */
export const assetDragType = "application/x-toonflow-video-assets";

/** 源监视器在文件上的标记：文件内秒数，null 表示文件开头 / 结尾。 */
export interface SourceMarks { in: number | null; out: number | null }

/** 在 `t` 标记入点或出点；另一个标记落到错误一侧时清除。 */
export const markAt = (marks: SourceMarks, which: "in" | "out", t: number): SourceMarks =>
  which === "in" ? { in: t, out: marks.out !== null && marks.out <= t ? null : marks.out } : { in: marks.in !== null && marks.in >= t ? null : marks.in, out: t };

/** 由整段文件片段得到标记区间的片段。 */
export function rangeClip(whole: VideoClip, marks: SourceMarks): VideoClip {
  if (whole.kind === "image") return whole;
  const end = whole.srcDuration ?? whole.out;
  const a = Math.max(0, Math.min(marks.in ?? 0, end));
  const b = Math.max(0, Math.min(marks.out ?? end, end));
  let low = Math.min(a, b);
  let high = Math.max(a, b);
  if (high - low < minSeconds) {
    high = end;
    low = Math.max(0, Math.min(low, high - minSeconds));
  }
  return { ...whole, in: low, out: high };
}

/** 切开轨道上跨越 `at` 的内容，使编辑从干净的边缘开始。 */
function cutTrack(doc: VideoDoc, trackId: string, at: number): VideoDoc {
  const places = placeAll(doc);
  const ids = doc.clips.filter(clip => clip.track === trackId && places.get(clip.id)!.start < at - edgeEps && places.get(clip.id)!.end > at + edgeEps).map(clip => clip.id);
  return ids.length ? splitItems(doc, ids, at).doc : doc;
}

/** 在轨道 `at` 处放入 `clip`：插入把其后内容后移，覆盖替换 `[at, at + 时长)` 的内容。磁性轨超过末尾时直接追加。 */
export function putRange(doc: VideoDoc, clip: VideoClip, trackId: string, at: number, mode: "insert" | "overwrite"): VideoDoc {
  const track = doc.tracks.find(item => item.id === trackId);
  if (!track) return doc;
  const length = clipLength(clip);
  let next = cutTrack(doc, trackId, at);
  if (mode === "overwrite") {
    next = cutTrack(next, trackId, at + length);
    const places = placeAll(next);
    next = remove(next, next.clips.filter(item => item.track === trackId && places.get(item.id)!.start >= at - edgeEps && places.get(item.id)!.end <= at + length + edgeEps).map(item => item.id));
  } else if (!track.magnetic) {
    const places = placeAll(next);
    next = { ...next, clips: next.clips.map(item => (item.track === trackId && places.get(item.id)!.start >= at - edgeEps ? { ...item, start: (item.start ?? 0) + length } : item)) };
  }
  next = { ...next, clips: [...next.clips, { ...clip, track: trackId }] };
  if (!track.magnetic) return placeClip(next, clip.id, trackId, { start: at });
  const places = placeAll(next);
  const index = next.clips.filter(item => item.track === trackId && item.id !== clip.id && places.get(item.id)!.start < at - edgeEps).length;
  return placeClip(next, clip.id, trackId, { index });
}
