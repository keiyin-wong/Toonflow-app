// Agent 剪辑操作：服务端已按 schema 校验参数，这里把一批操作套到时间线上，复用面板自己的纯函数。

import type { VideoClip, VideoDirection, VideoDoc, VideoTextStyle, VideoTransitionKind } from "./types";
import {
  addTrack, clipLength, closeGaps, docLength, insertIndex, magneticTrack, mediaKind, patchClips, patchTexts, placeAll, placeClip, splitItems, subtitleStyle,
  syncDelete, textSeconds, titleStyle, transitionSeconds, trim, uid, itemsAcross, fits,
} from "./timeline";

type Op =
  | { op: "addMedia"; paths: string[]; track?: string; at?: number }
  | { op: "remove"; ids: string[]; ripple?: boolean }
  | { op: "split"; at: number; ids?: string[] }
  | { op: "trim"; id: string; in?: number; out?: number }
  | { op: "move"; id: string; at: number; track?: string }
  | ({ op: "setClip"; ids: string[]; kenBurns?: boolean } & Partial<Pick<VideoClip, "speed" | "volume" | "muted" | "hidden" | "fit" | "opacity" | "scale" | "x" | "y" | "fadeIn" | "fadeOut" | "audioFadeIn" | "audioFadeOut">>)
  | { op: "transition"; ids: string[]; kind: VideoTransitionKind | "cut"; duration?: number; direction?: VideoDirection }
  | { op: "addText"; text: string; start: number; duration?: number; track?: string; style?: "subtitle" | "title" }
  | { op: "setText"; id: string; text?: string; start?: number; duration?: number }
  | { op: "subtitles"; lines: { start: number; end: number; text: string }[]; track?: string; replace?: boolean }
  | { op: "format"; width?: number; height?: number; fps?: number; background?: string }
  | { op: "marker"; time: number; label?: string }
  | { op: "closeGaps"; track?: string }
  | { op: "addTrack"; kind: "video" | "audio" | "text" };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** 先读取所有要加入的素材（探测时长与尺寸），失败时整批不生效。 */
export async function probeOps(ops: Op[], clipFor: (path: string, track: string) => Promise<VideoClip | null>) {
  const clips = new Map<string, VideoClip>();
  for (const op of ops) {
    if (op.op !== "addMedia") continue;
    for (const path of op.paths) {
      if (clips.has(path)) continue;
      if (!mediaKind(path)) throw new Error(`${path} 不是视频、图片或音频，不能放到时间线上`);
      const clip = await clipFor(path, "");
      if (!clip) throw new Error(`无法读取 ${path}`);
      clips.set(path, clip);
    }
  }
  return clips;
}

export function applyOps(start: VideoDoc, ops: Op[], probed: Map<string, VideoClip>): { doc: VideoDoc; made: string[] } {
  let doc = start;
  const made: string[] = [];
  const track = (id: string) => {
    const found = doc.tracks.find(item => item.id === id || item.name === id);
    if (!found) throw new Error(`没有轨道 ${id}`);
    if (found.locked) throw new Error(`轨道 ${found.name} 已锁定`);
    return found;
  };
  const clipOf = (id: string) => {
    const found = doc.clips.find(item => item.id === id);
    if (!found) throw new Error(`没有片段 ${id}`);
    return found;
  };
  const known = (ids: string[]) => {
    for (const id of ids) if (!doc.clips.some(item => item.id === id) && !doc.texts.some(item => item.id === id) && !doc.markers.some(item => item.id === id)) throw new Error(`没有片段或文字 ${id}`);
    return ids;
  };
  const textTrack = (id?: string) => {
    const found = id ? track(id) : doc.tracks.find(item => item.kind === "text" && !item.locked);
    if (!found || found.kind !== "text") throw new Error("没有可用的文字轨，先 addTrack kind:'text'");
    return found;
  };
  const styleOn = (trackId: string, kind: "subtitle" | "title" = "subtitle"): VideoTextStyle =>
    kind === "title" ? titleStyle : doc.texts.filter(item => item.track === trackId && !item.shape).pop()?.style ?? subtitleStyle;

  for (const [index, op] of ops.entries()) {
    try {
      if (op.op === "addMedia") {
        const target = op.track ? track(op.track) : undefined;
        let at = op.at;
        let insert = target?.magnetic !== false && at !== undefined ? insertIndex(doc, at) : undefined;
        for (const path of op.paths) {
          const source = probed.get(path)!;
          const destination = source.kind === "audio"
            ? (target?.kind === "audio" ? target : doc.tracks.find(item => item.kind === "audio" && !item.locked))
            : target?.kind === "video" ? target : magneticTrack(doc);
          if (!destination || !fits(source, destination)) throw new Error(`没有可放 ${path} 的轨道`);
          const clip = { ...source, id: uid(), track: destination.id };
          doc = { ...doc, clips: [...doc.clips, clip] };
          if (destination.magnetic) {
            doc = placeClip(doc, clip.id, destination.id, { index: insert ?? Infinity });
            if (insert !== undefined) insert++;
          } else {
            const from = at ?? 0;
            doc = placeClip(doc, clip.id, destination.id, { start: from });
            at = from + clipLength(clip);
          }
          made.push(clip.id);
        }
      } else if (op.op === "remove") doc = syncDelete(doc, known(op.ids), op.ripple ?? true);
      else if (op.op === "split") {
        const ids = op.ids ? known(op.ids) : itemsAcross(doc, op.at);
        doc = splitItems(doc, ids, op.at).doc;
      } else if (op.op === "trim") {
        const text = doc.texts.find(item => item.id === op.id);
        if (text) throw new Error("文字用 setText 修改 start/duration");
        const clip = clipOf(op.id);
        const speed = clip.kind === "image" || clip.kind === "effect" ? 1 : clip.speed ?? 1;
        if (op.in !== undefined) doc = trim(doc, clip.id, "start", (op.in - clip.in) / speed);
        if (op.out !== undefined) {
          const current = clipOf(op.id);
          doc = trim(doc, clip.id, "end", (op.out - current.out) / speed);
        }
      } else if (op.op === "move") {
        const text = doc.texts.find(item => item.id === op.id);
        if (text) {
          const destination = op.track ? textTrack(op.track) : undefined;
          doc = patchTexts(doc, [op.id], () => ({ start: op.at, ...(destination && { track: destination.id }) }));
        } else {
          const clip = clipOf(op.id);
          const destination = op.track ? track(op.track) : track(clip.track);
          if (!fits(clip, destination)) throw new Error(`片段不能放到 ${destination.name}`);
          doc = destination.magnetic
            ? placeClip(doc, clip.id, destination.id, { index: insertIndex(doc, op.at, clip.id) })
            : placeClip(doc, clip.id, destination.id, { start: op.at });
        }
      } else if (op.op === "setClip") {
        const { op: _op, ids, kenBurns, ...patch } = op;
        for (const id of ids) clipOf(id);
        doc = patchClips(doc, ids, {
          ...patch,
          ...(kenBurns !== undefined && { kenBurns: kenBurns ? { from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.15, x: 0.5, y: 0.5 } } : undefined }),
        });
      } else if (op.op === "transition") {
        const magneticId = magneticTrack(doc).id;
        for (const id of op.ids) if (clipOf(id).track !== magneticId) throw new Error(`转场只能加在 V1 片段上：${id}`);
        doc = patchClips(doc, op.ids, {
          transition: op.kind === "cut" ? undefined : { kind: op.kind, duration: op.duration ?? transitionSeconds[op.kind], ...(op.direction && { direction: op.direction }) },
        });
      } else if (op.op === "addText") {
        const target = textTrack(op.track);
        const id = uid();
        doc = { ...doc, texts: [...doc.texts, { id, track: target.id, text: op.text, start: op.start, duration: op.duration ?? textSeconds, style: styleOn(target.id, op.style) }] };
        made.push(id);
      } else if (op.op === "setText") {
        if (!doc.texts.some(item => item.id === op.id)) throw new Error(`没有文字 ${op.id}`);
        doc = patchTexts(doc, [op.id], () => ({
          ...(op.text !== undefined && { text: op.text }), ...(op.start !== undefined && { start: op.start }), ...(op.duration !== undefined && { duration: op.duration }),
        }));
      } else if (op.op === "subtitles") {
        const target = textTrack(op.track);
        const style = styleOn(target.id);
        const lines = op.lines.filter(line => line.end > line.start).map(line => ({ id: uid(), track: target.id, text: line.text, start: line.start, duration: line.end - line.start, style }));
        doc = { ...doc, texts: [...doc.texts.filter(item => !(op.replace ?? true) || item.track !== target.id || item.shape), ...lines] };
        made.push(...lines.map(line => line.id));
      } else if (op.op === "format") {
        const { op: _op, ...patch } = op;
        doc = { ...doc, ...patch };
      } else if (op.op === "marker") {
        const id = uid();
        doc = { ...doc, markers: [...doc.markers, { id, time: op.time, label: op.label ?? "" }] };
        made.push(id);
      } else if (op.op === "closeGaps") {
        const target = op.track ? track(op.track) : magneticTrack(doc);
        if (!target.magnetic) doc = closeGaps(doc, target.id);
      } else if (op.op === "addTrack") {
        const result = addTrack(doc, op.kind);
        doc = result.doc;
        made.push(result.track.id);
      }
    } catch (error) {
      throw new Error(`第 ${index + 1} 项 ${op.op}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { doc, made };
}

/** 给 Agent 看的工程内容：按轨道列出片段与文字的实际时间线位置。 */
export function describeDoc(doc: VideoDoc) {
  const places = placeAll(doc);
  const magneticId = magneticTrack(doc).id;
  return {
    format: { width: doc.width, height: doc.height, fps: doc.fps, background: doc.background },
    length: round(docLength(doc, places)),
    tracks: doc.tracks.map(({ id, kind, name, magnetic, locked, hidden, muted }) => ({ id, kind, name, ...(magnetic && { magnetic }), ...(locked && { locked }), ...(hidden && { hidden }), ...(muted && { muted }) })),
    clips: doc.clips.map(clip => {
      const place = places.get(clip.id)!;
      return {
        id: clip.id, track: clip.track, kind: clip.kind, name: clip.name, ...(clip.kind !== "effect" && { src: clip.src }),
        start: round(place.start), end: round(place.end), in: round(clip.in), out: round(clip.out),
        ...(clip.srcDuration && { srcDuration: round(clip.srcDuration) }), ...(clip.speed && clip.speed !== 1 && { speed: clip.speed }),
        ...(clip.volume !== undefined && { volume: clip.volume }), ...(clip.muted && { muted: true }), ...(clip.hidden && { hidden: true }),
        ...(clip.track === magneticId && clip.transition && { transition: clip.transition }), ...(clip.effect && { effect: clip.effect.kind }),
      };
    }).sort((a, b) => a.track.localeCompare(b.track) || a.start - b.start),
    texts: doc.texts.map(text => ({
      id: text.id, track: text.track, text: text.text.length > 200 ? `${text.text.slice(0, 200)}…` : text.text,
      start: round(text.start), end: round(text.start + text.duration), ...(text.shape && { shape: text.shape.kind }),
    })).sort((a, b) => a.track.localeCompare(b.track) || a.start - b.start),
    markers: doc.markers.map(({ id, time, label }) => ({ id, time: round(time), label })),
  };
}
