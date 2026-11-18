// 导出计划：把时间线转换为一张 FFmpeg 滤镜图。纯函数，不执行任何命令。
// 画面先铺背景色，再从后到前把每个可见片段按位置与时间叠加（overlay + enable），最后叠加文字。文字、蒙版、裁切与不透明度不由 FFmpeg 绘制，
// 由浏览器用绘制预览的同一代码生成 PNG，保证两者一致。位置与可见度来自 videoModel.ts 中与预览相同的函数。

import type { VideoBlend, VideoClip, VideoDoc, VideoExportOptions, VideoKeyframe, VideoText, VideoTextMotion } from "./types";
import {
  boxSize, clipLength, dirBlurMax, docLength, flashRise, fxGrid, glitchJolt, glitchJoltHz, glitchOn, glitchSplit, glitchWaves, grainMax, isKeyed, leakBlobs,
  maxScale, motionDistance, motionSeconds, needsMask, oldFilmLook, placeAll, shakeMax, shakeWaves, textTracksBackToFront, vignetteInner, vignetteMax, videoTracksBackToFront, type Place,
  borderPx, circleFeather, directionVector, spinMax, textWipeBlur, textWipeSoft, transitionEffects, transitionStyle, wipeFeather, zoomMax,
} from "./videoModel";

/** 秒数与小数按 FFmpeg 读取的格式输出。 */
const n = (value: number) => (Math.round(value * 1000) / 1000).toString();
const audioFormat = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
const dipColor = (kind: string) => (kind === "dipWhite" ? "white" : "black");
/** 混合模式对应的 FFmpeg blend 名称（第一输入为下层，第二输入为片段），以及该模式下不改变画面的中性色。 */
const blendFilters: Partial<Record<VideoBlend, [string, string]>> = {
  multiply: ["multiply", "white"], darken: ["darken", "white"], "color-burn": ["burn", "white"],
  screen: ["screen", "black"], lighten: ["lighten", "black"], "plus-lighter": ["addition", "black"], "color-dodge": ["dodge", "black"],
  difference: ["difference", "black"], exclusion: ["exclusion", "black"],
  overlay: ["overlay", "0x808080"], "soft-light": ["softlight", "0x808080"], "hard-light": ["hardlight", "0x808080"],
};

/** 片段起点 `from` 到终点 `to` 的线性插值，表达式变量为 `v`。 */
const lerp = (from: number, to: number, place: Place, v = "t") =>
  from === to ? n(from) : `(${n(from)}+${n(to - from)}*clip((${v}-${n(place.start)})/${n(place.end - place.start)},0,1))`;

/** videoModel.ts 的 smooth()。 */
const smoothExpr = (k: string) => `(${k})*(${k})*(3-2*(${k}))`;

/** transitionShift 的表达式形式：移动类转场的位移（画面比例）。 */
function shiftExpr(place: Place, v = "t"): { x: string; y: string } {
  const xs: string[] = [];
  const ys: string[] = [];
  if (place.into && transitionStyle(place.into.kind) === "move") {
    const [vx, vy] = directionVector[place.into.dir ?? "left"];
    const left = `(1-${smoothExpr(`clip((${v}-${n(place.start)})/${n(place.into.d)},0,1)`)})`;
    if (vx) xs.push(`(${-vx})*${left}`);
    if (vy) ys.push(`(${-vy})*${left}`);
  }
  if (place.outOf && (place.outOf.kind === "push" || place.outOf.kind === "whip")) {
    const [vx, vy] = directionVector[place.outOf.dir ?? "left"];
    const gone = smoothExpr(`clip((${v}-${n(place.end - place.outOf.d)})/${n(place.outOf.d)},0,1)`);
    if (vx) xs.push(`(${vx})*${gone}`);
    if (vy) ys.push(`(${vy})*${gone}`);
  }
  return { x: xs.join("+") || "0", y: ys.join("+") || "0" };
}

/** revealAlpha 的 geq 表达式（X、Y、W、H、T），没有揭开转场时为 null。 */
function revealExpr(place: Place): string | null {
  if (!place.into || transitionStyle(place.into.kind) !== "reveal") return null;
  const e = smoothExpr(`clip((T-${n(place.start)})/${n(place.into.d)},0,1)`);
  if (place.into.kind === "circle") {
    const feather = `(${n(circleFeather)}*min(W,H))`;
    return `clip((${e}*(hypot(W,H)/2+${feather})-hypot(X+0.5-W/2,Y+0.5-H/2))/${feather},0,1)`;
  }
  const dir = place.into.dir ?? "left";
  const along = dir === "right" ? "(X+0.5)/W" : dir === "left" ? "(1-(X+0.5)/W)" : dir === "down" ? "(Y+0.5)/H" : "(1-(Y+0.5)/H)";
  return `clip((${e}*${n(1 + wipeFeather)}-${along})/${n(wipeFeather)},0,1)`;
}

/** 转场期间把揭开效果应用到画面透明度。 */
const revealFilter = (place: Place, expr: string) =>
  `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*${expr}':enable='between(t,${n(place.start)},${n(place.start + place.into!.d)})'`;

/** 旧版 atempo 每级只支持 0.5–2，超出时串联。 */
function atempo(speed: number): string[] {
  const filters: string[] = [];
  let rest = speed;
  while (rest > 2) { filters.push("atempo=2"); rest /= 2; }
  while (rest < 0.5) { filters.push("atempo=0.5"); rest /= 0.5; }
  if (Math.abs(rest - 1) > 1e-3) filters.push(`atempo=${n(rest)}`);
  return filters;
}

type Matrix = number[][];
const multiply = (a: Matrix, b: Matrix): Matrix => a.map(row => [0, 1, 2].map(column => row.reduce((sum, value, index) => sum + value * b[index]![column]!, 0)));

/** CSS 的 hue-rotate()、sepia()、grayscale() 合成为一个矩阵（Filter Effects 规范），按此顺序应用。 */
function colorMatrix(clip: VideoClip): Matrix | null {
  const matrices: Matrix[] = [];
  if (clip.hue) {
    const angle = (clip.hue * Math.PI) / 180;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    matrices.push([
      [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928],
      [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283],
      [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072],
    ]);
  }
  if (clip.sepia) {
    const k = 1 - Math.min(1, clip.sepia);
    matrices.push([
      [0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k],
      [0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k],
      [0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k],
    ]);
  }
  if (clip.grayscale) {
    const k = 1 - Math.min(1, clip.grayscale);
    matrices.push([
      [0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k],
      [0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k],
      [0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k],
    ]);
  }
  return matrices.length ? matrices.reduce((acc, matrix) => multiply(matrix, acc)) : null;
}

/** 亮度、对比度、饱和度，然后是色相 / 棕褐 / 灰度，与预览 CSS filter 顺序一致。 */
function colorFilters(clip: VideoClip): string[] {
  const filters: string[] = [];
  const brightness = clip.brightness ?? 1;
  const contrast = clip.contrast ?? 1;
  const saturation = clip.saturation ?? 1;
  if (brightness !== 1) filters.push(`colorchannelmixer=rr=${n(brightness)}:gg=${n(brightness)}:bb=${n(brightness)}`);
  if (contrast !== 1 || saturation !== 1) filters.push(`eq=contrast=${n(contrast)}:saturation=${n(saturation)}`);
  const matrix = colorMatrix(clip);
  if (matrix) {
    const names = ["r", "g", "b"];
    filters.push(`colorchannelmixer=${matrix.flatMap((row, i) => row.map((value, j) => `${names[i]}${names[j]}=${value.toFixed(4)}`)).join(":")}`);
  }
  return filters;
}

/** 关键帧的 FFmpeg 表达式（时间变量 `v` 为时间线秒数，片段从 `start` 开始），曲线与 keysAt 一致。 */
export function keyExpr(keys: VideoKeyframe[], start: number, v = "t"): string {
  const local = start ? `(${v}-${n(start)})` : v;
  let expr = n(keys[keys.length - 1]!.v);
  for (let index = keys.length - 1; index >= 1; index--) {
    const [a, b] = [keys[index - 1]!, keys[index]!];
    if (b.t - a.t < 1e-6) continue;
    const k = `(${local}-${n(a.t)})/${n(b.t - a.t)}`;
    const along = a.ease === "in" ? `pow(${k},2)` : a.ease === "out" ? `(1-pow(1-${k},2))` : a.ease === "inOut" ? `(pow(${k},2)*(3-2*${k}))` : k;
    expr = a.ease === "hold" ? `if(lt(${local},${n(b.t)}),${n(a.v)},${expr})` : `if(lt(${local},${n(b.t)}),${n(a.v)}+${n(b.v - a.v)}*${along},${expr})`;
  }
  return keys.length > 1 ? `if(lt(${local},${n(keys[0]!.t)}),${n(keys[0]!.v)},${expr})` : expr;
}

/** 文字滑动（textOffsetAt）作为 overlay 的 x、y 像素表达式。 */
function textMotion(text: VideoText): { x: string; y: string } {
  const parts = { x: [] as string[], y: [] as string[] };
  const add = (motion: VideoTextMotion, k: string) => {
    const axis = motion === "left" || motion === "right" ? "x" : "y";
    const sign = motion === "left" || motion === "up" ? -1 : 1;
    parts[axis].push(`${axis === "x" ? "W" : "H"}*${n(sign * motionDistance[axis])}*${k}`);
  };
  if (text.motionIn) add(text.motionIn, `(-pow(1-clip((t-${n(text.start)})/${n(text.fadeIn || motionSeconds)},0,1),2))`);
  if (text.motionOut) {
    const duration = text.fadeOut || motionSeconds;
    add(text.motionOut, `pow(clip((t-${n(text.start + text.duration - duration)})/${n(duration)},0,1),2)`);
  }
  return { x: parts.x.join("+") || "0", y: parts.y.join("+") || "0" };
}

/** 导出选项，或为渲染单帧指定 `frameAt`。 */
export interface PlanOptions extends VideoExportOptions { frameAt?: number }

const crfByQuality = { high: 18, medium: 23, small: 28 } as const;

/** '#ff9a3c' → [255, 154, 60]。 */
const rgbOf = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) || 0) as [number, number, number];

/** 片段画面的淡入淡出（见 visibilityAt）：透明度淡化与转场闪色。 */
function pictureFades(clip: VideoClip, place: Place): string[] {
  const filters: string[] = [];
  if (clip.fadeIn) filters.push(`fade=t=in:st=${n(place.start)}:d=${n(clip.fadeIn)}:alpha=1`);
  if (clip.fadeOut) filters.push(`fade=t=out:st=${n(place.end - clip.fadeOut)}:d=${n(clip.fadeOut)}:alpha=1`);
  const into = place.into && transitionStyle(place.into.kind);
  if (into === "fade") filters.push(`fade=t=in:st=${n(place.start)}:d=${n(place.into!.d)}:alpha=1`);
  else if (into === "dip") filters.push(`fade=t=in:st=${n(place.start + place.into!.d / 2)}:d=${n(place.into!.d / 2)}:color=${dipColor(place.into!.kind)}`);
  if (place.outOf && transitionStyle(place.outOf.kind) === "dip") filters.push(`fade=t=out:st=${n(place.end - place.outOf.d)}:d=${n(place.outOf.d / 2)}:color=${dipColor(place.outOf.kind)}`);
  return filters;
}

/** 片段声音的淡入淡出，以片段自身时间计（0 为其在时间线上的起点），见 gainAt。 */
function soundFades(clip: VideoClip, place: Place): string[] {
  const length = place.end - place.start;
  const filters: string[] = [];
  if (clip.audioFadeIn) filters.push(`afade=t=in:st=0:d=${n(clip.audioFadeIn)}`);
  if (clip.audioFadeOut) filters.push(`afade=t=out:st=${n(length - clip.audioFadeOut)}:d=${n(clip.audioFadeOut)}`);
  if (place.into) filters.push(transitionStyle(place.into.kind) !== "dip" ? `afade=t=in:st=0:d=${n(place.into.d)}` : `afade=t=in:st=${n(place.into.d / 2)}:d=${n(place.into.d / 2)}`);
  if (place.outOf) filters.push(transitionStyle(place.outOf.kind) !== "dip" ? `afade=t=out:st=${n(length - place.outOf.d)}:d=${n(place.outOf.d)}` : `afade=t=out:st=${n(length - place.outOf.d)}:d=${n(place.outOf.d / 2)}`);
  return filters;
}

/** 导出读取的已写入工作区的 PNG：片段蒙版与文字图（工作区相对路径），以及模糊擦除需要的文字范围。 */
export interface AssetFiles { masks: Record<string, string>; texts: Record<string, string>; boxes: Record<string, { x: number; y: number; w: number; h: number }> }

/** 一个输入：工作区相对路径与放在 `-i` 之前的选项。 */
export interface PlanInput { path: string; options: string[] }

/**
 * 时间线的 FFmpeg 输入、滤镜图与输出选项。`hasAudio(clip)` 表示视频片段的文件是否有声音。
 * 滤镜图写入文件后以 `-filter_complex_script` 传入，避免长时间线超出 Windows 命令行长度。
 */
export function exportPlan(doc: VideoDoc, hasAudio: (clip: VideoClip) => boolean, assets: AssetFiles, options: PlanOptions = {}): { inputs: PlanInput[]; graph: string; outputOptions: string[]; length: number } {
  const { width: W, height: H, fps } = doc;
  const places = placeAll(doc);
  const total = Math.max(docLength(doc, places), 1 / fps);
  const format = options.frameAt !== undefined ? "frame" : options.format ?? "mp4";
  const soundOnly = format === "mp3" || format === "wav";
  const pictures = !soundOnly;
  // 只混入选中的轨道；MP4 一条都不选时输出无音轨的视频（方便另行配音）。
  const heardTrack = (id: string) => !options.audioTracks || options.audioTracks.includes(id);
  const shownTrack = (id: string) => !options.shownTracks || options.shownTracks.includes(id);
  const sound = soundOnly || (format === "mp4" && options.audioTracks?.length !== 0);
  // 渲染范围 [a, b)。
  const a = options.range ? Math.max(0, Math.min(options.range.start, total - 1 / fps)) : 0;
  const b = options.range ? Math.max(a + 1 / fps, Math.min(options.range.end, total)) : total;
  const ranged = a > 0 || b < total;
  const inputs: PlanInput[] = [];
  const graph: string[] = pictures ? [`color=c=${doc.background}:s=${W}x${H}:r=${fps}:d=${n(total)},format=yuv420p[base]`] : [];
  const sounds: string[] = [];
  let comp = "base";
  let layer = 0;
  const addInput = (path: string, inputOptions: string[]) => inputs.push({ path, options: inputOptions }) - 1;
  const overlay = (stream: string, x: string, y: string, enable: string) => {
    const next = `L${layer++}`;
    graph.push(`[${comp}][${stream}]overlay=x='${x}':y='${y}':enable='${enable}':eof_action=pass[${next}]`);
    comp = next;
  };

  /** 混合模式片段：先叠到该模式的中性色画面上，再整体与下层在 RGB 中混合，与 CSS mix-blend-mode 一致。片段之外与淡出处显示中性色，不改变画面。 */
  const blendOver = (stream: string, mode: VideoBlend, x: string, y: string, enable: string) => {
    const [name, neutral] = blendFilters[mode]!;
    const id = `B${layer}`;
    graph.push(`color=c=${neutral}:s=${W}x${H}:r=${fps}:d=${n(total)},format=yuva420p[${id}n]`);
    graph.push(`[${id}n][${stream}]overlay=x='${x}':y='${y}':enable='${enable}':eof_action=pass,format=gbrp[${id}l]`);
    graph.push(`[${comp}]format=gbrp[${id}b]`);
    const next = `L${layer++}`;
    graph.push(`[${id}b][${id}l]blend=all_mode=${name},format=yuv420p[${next}]`);
    comp = next;
  };

  const clipInput = (clip: VideoClip) => clip.kind === "image"
    ? addInput(clip.src, ["-loop", "1", "-framerate", String(fps), "-t", n(clipLength(clip))])
    : addInput(clip.src, ["-ss", n(clip.in), "-t", n(clip.out - clip.in)]);

  // 画面，从后到前。
  for (const track of videoTracksBackToFront(doc)) {
    const muted = !!track.muted || !heardTrack(track.id);
    const visible = !track.hidden && shownTrack(track.id);
    // 先应用特效：它们改变的是此轨之下已绘制的内容。
    if (pictures && visible) for (const clip of doc.clips.filter(item => item.track === track.id && item.kind === "effect" && !item.hidden && item.effect)) applyEffect(clip, places.get(clip.id)!);
    for (const clip of doc.clips.filter(item => item.track === track.id && item.kind !== "effect")) {
      const place = places.get(clip.id)!;
      const speed = clip.kind === "image" ? 1 : clip.speed ?? 1;
      const heard = sound && clip.kind === "video" && !muted && !clip.muted && (isKeyed(clip, "volume") || (clip.volume ?? 1) > 0) && hasAudio(clip);
      const drawn = pictures && visible && !clip.hidden;
      if (!heard && !drawn) continue;
      const input = clipInput(clip);
      if (heard) sounds.push(soundChain(clip, place, input, speed));
      if (!drawn) continue;
      const id = `c${input}`;
      // 尺寸有关键帧的片段按最大尺寸生成一次，最后再逐帧缩放，后续滤镜无需处理变化的帧尺寸。
      const scaled = isKeyed(clip, "scale");
      const top = maxScale(clip);
      const box = boxSize(doc, clip, top);
      const into = place.into && transitionStyle(place.into.kind);
      const visibleFrom = into === "dip" || into === "cut" ? place.start + place.into!.d / 2 : place.start;
      const shift = shiftExpr(place);
      const reveal = revealExpr(place);
      const enable = `between(t,${n(visibleFrom)},${n(place.end)})`;
      const timing = `setpts=(PTS-STARTPTS)/${n(speed)}+${n(place.start)}/TB,fps=${fps}`;
      const fades = pictureFades(clip, place);
      const pre = [timing, ...colorFilters(clip)].join(",");
      if (clip.fit === "blur") {
        graph.push(`[${input}:v]${pre},split[${id}m][${id}b]`);
        graph.push(`[${id}b]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,colorchannelmixer=rr=0.75:gg=0.75:bb=0.75,format=yuva420p${reveal ? "," + revealFilter(place, reveal) : ""}${fades.length ? "," + fades.join(",") : ""}[${id}bg]`);
        overlay(`${id}bg`, `W*(${shift.x})`, `H*(${shift.y})`, enable);
      } else graph.push(`[${input}:v]${pre}[${id}m]`);

      const chain: string[] = [];
      if (clip.kenBurns) {
        const { from, to } = clip.kenBurns;
        const zoom = lerp(Math.max(1, from.zoom), Math.max(1, to.zoom), place, "it");
        const focusX = lerp(from.x, to.x, place, "it");
        const focusY = lerp(from.y, to.y, place, "it");
        // 先放大避免 zoompan 整像素步进抖动；zoompan 会重置时钟，需要还原。
        chain.push(`scale=${box.w * 2}:${box.h * 2}`, `zoompan=z='${zoom}':x='clip(${focusX}*iw-iw/zoom/2,0,iw-iw/zoom)':y='clip(${focusY}*ih-ih/zoom/2,0,ih-ih/zoom)':d=1:s=${box.w}x${box.h}:fps=${fps}`, `setpts=PTS-STARTPTS+${n(place.start)}/TB`);
      } else chain.push(`scale=${box.w}:${box.h}`);
      chain.push("format=yuva420p");
      // CSS blur() 以画面像素计，片段定尺寸后再模糊。
      if (clip.blur && clip.blur > 0) chain.push(`gblur=sigma=${n(Math.min(clip.blur, 200))}`);
      let stream = `${id}s`;
      graph.push(`[${id}m]${chain.join(",")}[${stream}]`);
      if (needsMask(clip) && assets.masks[clip.id]) {
        const mask = addInput(assets.masks[clip.id]!, ["-loop", "1", "-framerate", String(fps), "-t", n(total)]);
        graph.push(`[${mask}:v]format=gray,scale=${box.w}:${box.h}[${id}k]`, `[${stream}][${id}k]alphamerge[${id}a]`);
        stream = `${id}a`;
      }
      const post: string[] = [];
      // 揭开在画框自身坐标、旋转之前应用（预览也是对未旋转的画框加蒙版）。
      if (reveal) post.push(revealFilter(place, reveal));
      if (isKeyed(clip, "rotation")) {
        // 任意角度都能容纳画框的正方形；填充必须透明，否则会露出之前的帧。
        post.push(`rotate=a='(${keyExpr(clip.keys!.rotation!, place.start)})*PI/180':ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=black@0`);
      } else if (clip.rotation) {
        const radians = `${n(clip.rotation)}*PI/180`;
        post.push(`rotate=${radians}:ow=rotw(${radians}):oh=roth(${radians}):c=none`);
      }
      if (isKeyed(clip, "opacity")) post.push(`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*clip(${keyExpr(clip.keys!.opacity!, place.start, "T")},0,1)'`);
      post.push(...fades);
      if (scaled) {
        const factor = `(${keyExpr(clip.keys!.scale!, place.start)})/${n(top)}`;
        post.push(`scale=w='max(2,trunc(iw*${factor}/2)*2)':h='max(2,trunc(ih*${factor}/2)*2)':eval=frame`);
      }
      // 边框在抠出画框后添加，随画框旋转与淡化。
      const border = borderPx(clip, box.w, box.h);
      if (border) post.splice(reveal ? 1 : 0, 0, `pad=w=iw+${2 * border}:h=ih+${2 * border}:x=${border}:y=${border}:color=${clip.border!.color}`);
      if (post.length) {
        graph.push(`[${stream}]${post.join(",")}[${id}f]`);
        stream = `${id}f`;
      }
      const x0 = clip.x ?? 0.5;
      const y0 = clip.y ?? 0.5;
      const keyedPosition = isKeyed(clip, "x") || isKeyed(clip, "y");
      const xExpr = keyedPosition ? (isKeyed(clip, "x") ? keyExpr(clip.keys!.x!, place.start) : n(x0)) : lerp(x0, clip.moveTo?.x ?? x0, place);
      const yExpr = keyedPosition ? (isKeyed(clip, "y") ? keyExpr(clip.keys!.y!, place.start) : n(y0)) : lerp(y0, clip.moveTo?.y ?? y0, place);
      const ox = `W*(${xExpr}+${shift.x})-w/2`;
      const oy = `H*(${yExpr}+${shift.y})-h/2`;
      if (clip.blend && clip.blend !== "normal" && blendFilters[clip.blend]) blendOver(stream, clip.blend, ox, oy, enable);
      else overlay(stream, ox, oy, enable);
    }
    // 磁性轨的转场特效只作用于磁性轨（它是最底层）。
    if (pictures && visible && track.magnetic) for (const { c, p } of transitionEffects(doc, places)) applyEffect(c, p);
  }

  // 音频轨上的声音文件。
  if (sound) {
    for (const track of doc.tracks.filter(item => item.kind === "audio" && !item.muted && heardTrack(item.id))) {
      for (const clip of doc.clips.filter(item => item.track === track.id && !item.muted && (isKeyed(item, "volume") || (item.volume ?? 1) > 0))) {
        const place = places.get(clip.id)!;
        if (place.start >= total || (clip.kind === "video" && !hasAudio(clip))) continue;
        const input = addInput(clip.src, ["-ss", n(clip.in), "-t", n(clip.out - clip.in)]);
        sounds.push(soundChain(clip, place, input, clip.speed ?? 1));
      }
    }
  }

  // 文字盖在最上层，从后到前。
  for (const track of pictures ? textTracksBackToFront(doc) : []) {
    if (track.hidden || !shownTrack(track.id)) continue;
    for (const text of doc.texts.filter(item => item.track === track.id)) {
      const file = assets.texts[text.id];
      if (!file || text.start >= total) continue;
      const input = addInput(file, ["-loop", "1", "-framerate", String(fps), "-t", n(total)]);
      const fades = [text.fadeIn && `fade=t=in:st=${n(text.start)}:d=${n(text.fadeIn)}:alpha=1`, text.fadeOut && `fade=t=out:st=${n(text.start + text.duration - text.fadeOut)}:d=${n(text.fadeOut)}:alpha=1`].filter(Boolean);
      graph.push(`[${input}:v]format=yuva420p${fades.length ? "," + fades.join(",") : ""}[t${input}]`);
      const motion = textMotion(text);
      const shown = `between(t,${n(text.start)},${n(text.start + text.duration)})`;
      const box = assets.boxes[text.id];
      if (box && box.w > 0 && (text.wipeIn || text.wipeOut)) {
        // 模糊擦除（textWipeAt / textWipeAlpha）：边缘前的带状区域显示模糊副本，之后是清晰副本。
        const end = text.start + text.duration;
        const kIn = text.wipeIn ? `clip((T-${n(text.start)})/${n(text.wipeIn)},0,1)` : "1";
        const kOut = text.wipeOut ? `clip((${n(end)}-T)/${n(text.wipeOut)},0,1)` : "1";
        const wiping = [text.wipeIn && `between(t,${n(text.start)},${n(text.start + text.wipeIn)})`, text.wipeOut && `between(t,${n(end - text.wipeOut)},${n(end)})`].filter(Boolean).join("+");
        const soft = textWipeSoft;
        const edge = `(if(lt(T,${n(text.start + text.duration / 2)}),${kIn},${kOut})*${n(1 + 2 * soft)})`;
        const u = `((X-${n(box.x)})/${n(box.w)})`;
        const sharp = `clip((${edge}-${n(soft)}-${u})/${n(soft)},0,1)`;
        const blurred = `(clip((${edge}-${u})/${n(soft)},0,1)-${sharp})`;
        const alpha = (expr: string) => `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*${expr}':enable='${wiping}'`;
        graph.push(`[t${input}]split[t${input}a][t${input}b]`, `[t${input}b]gblur=sigma=${n(textWipeBlur * W)}:enable='${wiping}',${alpha(blurred)}[t${input}c]`, `[t${input}a]${alpha(sharp)}[t${input}d]`);
        overlay(`t${input}c`, motion.x, motion.y, `${shown}*(${wiping})`);
        overlay(`t${input}d`, motion.x, motion.y, shown);
      } else overlay(`t${input}`, motion.x, motion.y, shown);
    }
  }

  if (sound) {
    // 所有声音混合在一段成片时长的静音之上。
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n(total)}[silence]`);
    sounds.forEach((chain, index) => graph.push(`${chain}[s${index}]`));
    graph.push(`[silence]${sounds.map((_, index) => `[s${index}]`).join("")}amix=inputs=${sounds.length + 1}:duration=first:normalize=0${ranged ? `,atrim=start=${n(a)}:end=${n(b)},asetpts=PTS-STARTPTS` : ""}[mix]`);
  }
  if (pictures) {
    const tail: string[] = [];
    if (ranged) tail.push(`trim=start=${n(a)}:end=${n(b)}`, "setpts=PTS-STARTPTS");
    const scale = Math.min(1, Math.max(0.1, options.scale ?? 1));
    if (scale < 1) tail.push(`scale=${Math.max(2, Math.round((W * scale) / 2) * 2)}:${Math.max(2, Math.round((H * scale) / 2) * 2)}`);
    if (format === "gif") {
      tail.push(`fps=${Math.min(fps, 15)}`, "split[g1][g2]");
      graph.push(`[${comp}]${tail.join(",")}`, "[g1]palettegen=stats_mode=diff[pal]", "[g2][pal]paletteuse=dither=bayer:bayer_scale=4[vout]");
    } else graph.push(`[${comp}]${tail.length ? tail.join(",") : "null"}[vout]`);
  }

  const length = b - a;
  const outputOptions = format === "frame"
    ? ["-map", "[vout]", "-ss", n(Math.min(options.frameAt!, total - 1 / fps)), "-frames:v", "1", "-update", "1"]
    : format === "gif"
      ? ["-map", "[vout]", "-loop", "0", "-t", n(length)]
      : format === "mp3"
        ? ["-map", "[mix]", "-c:a", "libmp3lame", "-b:a", "192k", "-t", n(length)]
        : format === "wav"
          ? ["-map", "[mix]", "-c:a", "pcm_s16le", "-t", n(length)]
          : ["-map", "[vout]", ...(sound ? ["-map", "[mix]"] : []), "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crfByQuality[options.quality ?? "high"]), "-pix_fmt", "yuv420p", "-r", String(fps),
            ...(sound ? ["-c:a", "aac", "-b:a", "192k"] : []), "-movflags", "+faststart", "-t", n(length)];
  return { inputs, graph: graph.join(";\n"), outputOptions, length };

  /** 把特效片段（公式见 videoModel.ts 特效部分）在其起止时间内应用到目前合成的画面上。 */
  function applyEffect(clip: VideoClip, place: Place) {
    const effect = clip.effect!;
    const amount = effect.amount;
    const D = Math.max(1e-6, place.end - place.start);
    const on = `between(t,${n(place.start)},${n(place.end)})`;
    const tau = (v = "t") => `(${v}-${n(place.start)})`;
    const sines = (waves: readonly (readonly [number, number, number])[], v = "t") => waves.map(([weight, frequency, phase]) => `${n(weight)}*sin(2*PI*${n(frequency)}*${tau(v)}+${n(phase)})`).join("+");
    const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
    const grid = fxGrid(doc);
    const solid = (colour: string, w: number, h: number, pixelFormat: string) => `color=c=${colour}:s=${w}x${h}:r=${fps}:d=${n(total)},format=${pixelFormat}`;

    // 画面本身：片段调色与模糊，以及该类型自带的模糊或抖动。
    const look = effect.kind === "oldFilm" ? { ...clip, sepia: Math.min(1, (clip.sepia ?? 0) + oldFilmLook.sepia * amount) } : clip;
    const chain = [...colorFilters(look)];
    if (clip.blur && clip.blur > 0) chain.push(`gblur=sigma=${n(Math.min(clip.blur, 200))}`);
    if (effect.kind === "dirBlur" && amount > 0) chain.push(effect.direction === "vertical" ? `gblur=sigma=0:sigmaV=${n(amount * dirBlurMax)}` : `gblur=sigma=${n(amount * dirBlurMax)}:sigmaV=0`);
    if (effect.kind === "shake" && amount > 0) {
      const zoom = 1 + 2 * amount * shakeMax;
      const cropWidth = even(W / zoom);
      const cropHeight = even(H / zoom);
      // 放大 zoom 倍并位移 (dx, dy) 后实际出现在屏幕上的区域。
      const dx = `${n(amount * shakeMax)}*(${sines(shakeWaves.x)})`;
      const dy = `${n(amount * shakeMax)}*(${sines(shakeWaves.y)})`;
      chain.push(`crop=w=${cropWidth}:h=${cropHeight}:x='${n((W - cropWidth) / 2)}-(${dx})*${cropWidth}':y='${n((H - cropHeight) / 2)}-(${dy})*${cropHeight}'`, `scale=${W}:${H}`);
    }
    if (chain.length) stage(chain, on);
    if ((effect.kind === "zoom" || effect.kind === "spin") && amount > 0) {
      // zoomAt / spinAt。zoompan 的时钟为 `it`，rotate 为 `t`，trim 保留时间线时间。
      const K = (v: string) => `clip((${v}-${n(place.start)})/${n(D)},0,1)`;
      const angle = (v: string) => `(${n(2 * spinMax * amount)}*(${smoothExpr(K(v))}-gte(${smoothExpr(K(v))},0.5)))`;
      const spread = Math.max(W / H, H / W);
      const zoom = effect.kind === "zoom" ? `1+${n(amount * zoomMax)}*sin(PI*${K("it")})` : `cos(abs(${angle("it")})*PI/180)+sin(abs(${angle("it")})*PI/180)*${n(spread)}`;
      const turn = effect.kind === "spin" ? [`rotate=a='${angle("t")}*PI/180':ow=iw:oh=ih:c=black`] : [];
      windowed([...turn, `scale=${W * 2}:${H * 2}`, `zoompan=z='${zoom}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${W}x${H}:fps=${fps}`]);
    }
    if (effect.kind === "glitch" && amount > 0) {
      const burst = effect.steady ? "1" : `gt(${glitchWaves.map(([frequency, phase]) => `sin(2*PI*${n(frequency)}*${tau()}+${n(phase)})`).join("+")},${n(glitchOn)})`;
      const split = Math.max(1, Math.round(amount * glitchSplit * W));
      stage(["format=gbrp", `rgbashift=rh=${split}:bh=${-split}`, "format=yuv420p"], `${on}*${burst}`, `${n(amount * glitchJolt * W)}*sin(2*PI*${glitchJoltHz}*${tau()})`);
    }

    // 叠加层。
    const over = (source: string) => {
      const id = `E${layer}o`;
      graph.push(`${source}[${id}]`);
      overlay(id, "0", "0", on);
    };
    const blendWith = (source: string, mode: string) => {
      const id = `E${layer}`;
      graph.push(`${source}[${id}x]`, `[${comp}]format=gbrp[${id}b]`);
      const next = `L${layer++}`;
      graph.push(`[${id}b][${id}x]blend=all_mode=${mode}:enable='${on}',format=yuv420p[${next}]`);
      comp = next;
    };
    const grain = (strength: number) => {
      const id = `E${layer}g`;
      graph.push(`${solid("gray", even(W / 2), even(H / 2), "gray")},geq=lum=128,noise=alls=${Math.round(strength * grainMax)}:allf=t+u,scale=${W}:${H}:flags=neighbor,split=3[${id}1][${id}2][${id}3]`);
      blendWith(`[${id}1][${id}2][${id}3]mergeplanes=0x001020:gbrp`, "overlay");
    };
    const vignette = (strength: number) =>
      over(`${solid("black", grid.w, grid.h, "yuva420p")},geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${n(strength * vignetteMax)}*pow(clip((hypot((X+0.5)/W-0.5,(Y+0.5)/H-0.5)/hypot(0.5,0.5)-${n(vignetteInner)})/${n(1 - vignetteInner)},0,1),2)',scale=${W}:${H}:flags=bilinear`);
    if (effect.kind === "flash" && amount > 0) {
      const rise = flashRise * D;
      over(`${solid(`${effect.color ?? "#ffffff"}@${n(amount)}`, W, H, "yuva420p")},fade=t=in:st=${n(place.start)}:d=${n(rise)}:alpha=1,fade=t=out:st=${n(place.start + rise)}:d=${n(D - rise)}:alpha=1`);
    }
    if (effect.kind === "vignette" && amount > 0) vignette(amount);
    if (effect.kind === "grain" && amount > 0) grain(amount);
    if (effect.kind === "oldFilm" && amount > 0) {
      grain(amount * oldFilmLook.grain);
      vignette(amount * oldFilmLook.vignette);
      over(`${solid("black", 16, 16, "yuva420p")},geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${n(amount * oldFilmLook.flicker)}*(0.5+0.5*sin(2*PI*9*${tau("T")})*sin(2*PI*2.3*${tau("T")}+1))',scale=${W}:${H}`);
    }
    if (effect.kind === "lightLeak" && amount > 0) {
      const K = `clip(${tau("T")}/${n(D)},0,1)`;
      const blobs = leakBlobs.map(blob => `${n(blob.weight)}*exp(-(pow((X+0.5)/W-(${n(blob.x[0])}+${n(blob.x[1])}*${K}),2)+pow((Y+0.5)/H-(${n(blob.y[0])}+${n(blob.y[1])}*sin(2*PI*${K})),2))/${n(2 * blob.sigma * blob.sigma)})`).join("+");
      const level = `min(1,${n(amount)}*sin(PI*${K})*(${blobs}))`;
      const [r, g, bl] = rgbOf(effect.color ?? "#ff9a3c");
      blendWith(`${solid("black", grid.w, grid.h, "gbrp")},geq=r='${r}*${level}':g='${g}*${level}':b='${bl}*${level}',scale=${W}:${H}:flags=bilinear`, "screen");
    }

    /** 在截取到特效时段的画面副本上应用 `filters`，期间替代原画面（用于自带时钟的滤镜）。 */
    function windowed(filters: string[]) {
      const id = `E${layer}`;
      graph.push(`[${comp}]split[${id}a][${id}b]`, `[${id}b]trim=start=${n(Math.max(0, place.start))}:end=${n(place.end)},${filters.join(",")},setpts=PTS-STARTPTS+${n(Math.max(0, place.start))}/TB[${id}c]`);
      const next = `L${layer++}`;
      graph.push(`[${id}a][${id}c]overlay=enable='${on}':eof_action=pass[${next}]`);
      comp = next;
    }

    /** 在画面副本上应用 `filters`，`enable` 时替代原画面（可按 `x` 横向位移，露出背景）。 */
    function stage(filters: string[], enable: string, x?: string) {
      const id = `E${layer}`;
      graph.push(`[${comp}]split[${id}a][${id}b]`, `[${id}b]${filters.join(",")}[${id}c]`);
      let top = `${id}c`;
      if (x) {
        graph.push(`${solid(doc.background, W, H, "yuv420p")}[${id}g]`, `[${id}g][${id}c]overlay=x='${x}':y=0[${id}d]`);
        top = `${id}d`;
      }
      const next = `L${layer++}`;
      graph.push(`[${id}a][${top}]overlay=enable='${enable}'[${next}]`);
      comp = next;
    }
  }

  function soundChain(clip: VideoClip, place: Place, input: number, speed: number): string {
    const delay = Math.round(place.start * 1000);
    // asetpts 与 atempo 之后，`t` 为片段在时间线上经过的秒数，音量关键帧以此计时。
    const volume = isKeyed(clip, "volume") ? `volume='max(0,${keyExpr(clip.keys!.volume!, 0)})':eval=frame` : `volume=${n(clip.volume ?? 1)}`;
    return `[${input}:a]asetpts=PTS-STARTPTS,${[...atempo(speed), audioFormat, volume, ...soundFades(clip, place), `adelay=${delay}:all=1`].join(",")}`;
  }
}
