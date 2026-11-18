// 预览中特效片段的绘制：由与导出相同的函数与常量计算出每个时刻的图像与 CSS。

import type { VideoClip, VideoDoc } from "./types";
import {
  circleFeather, dirBlurMax, flashAlpha, flickerAlpha, fxGrid, glitchAt, glitchSplit, grainMax, leakLevel, oldFilmLook, shakeAt, spinAt, vignetteAlpha, wipeFeather, zoomAt,
  type Place, type Reveal,
} from "./videoModel";

/** 片段调色对应的 CSS filter，顺序与导出一致：亮度、对比度、饱和度、色相、棕褐、灰度。 */
export function cssFilters(clip: Pick<VideoClip, "brightness" | "contrast" | "saturation" | "hue" | "sepia" | "grayscale">): string {
  return [
    clip.brightness !== undefined && clip.brightness !== 1 && `brightness(${clip.brightness})`,
    clip.contrast !== undefined && clip.contrast !== 1 && `contrast(${clip.contrast})`,
    clip.saturation !== undefined && clip.saturation !== 1 && `saturate(${clip.saturation})`,
    clip.hue && `hue-rotate(${clip.hue}deg)`,
    clip.sepia && `sepia(${clip.sepia})`,
    clip.grayscale && `grayscale(${clip.grayscale})`,
  ].filter(Boolean).join(" ");
}

/** 特效需要的 SVG 滤镜（CSS 以 `url(#id)` 引用），单位为舞台像素。 */
export type FxFilter = { id: string; kind: "dirBlur"; sx: number; sy: number } | { id: string; kind: "split"; dx: number };

/** 叠加在特效下方画面之上的图层。 */
export type FxOverlay =
  | { key: string; kind: "solid"; color: string; alpha: number }
  | { key: string; kind: "vignette"; amount: number }
  | { key: string; kind: "grain"; amount: number; frame: number }
  | { key: string; kind: "leak"; amount: number; color: string; place: Place; time: number };

export interface FxLook { filter: string; transform: string; filters: FxFilter[]; overlays: FxOverlay[] }

/** 某轨在 `time` 运行的特效对下方画面的作用：CSS filter 与 transform（k 为每画面像素对应的舞台像素）、所用 SVG 滤镜及叠加层。 */
export function effectLook(doc: VideoDoc, effects: { c: VideoClip; p: Place }[], time: number, k: number): FxLook {
  const filter: string[] = [];
  const transform: string[] = [];
  const filters: FxFilter[] = [];
  const overlays: FxOverlay[] = [];
  for (const { c, p } of effects) {
    const effect = c.effect!;
    const amount = effect.amount;
    const look = effect.kind === "oldFilm" ? { ...c, sepia: Math.min(1, (c.sepia ?? 0) + oldFilmLook.sepia * amount) } : c;
    const colour = cssFilters(look);
    if (colour) filter.push(colour);
    if (c.blur && c.blur > 0) filter.push(`blur(${Math.min(c.blur, 200) * k}px)`);
    const id = `fx-${c.id}`;
    if (effect.kind === "dirBlur" && amount > 0) {
      const sigma = amount * dirBlurMax * k;
      filters.push({ id, kind: "dirBlur", sx: effect.direction === "vertical" ? 0 : sigma, sy: effect.direction === "vertical" ? sigma : 0 });
      filter.push(`url(#${id})`);
    }
    if (effect.kind === "shake" && amount > 0) {
      const shake = shakeAt(effect, p, time);
      transform.push(`translate(${shake.dx * doc.width * k}px, ${shake.dy * doc.height * k}px) scale(${shake.zoom})`);
    }
    if (effect.kind === "zoom" && amount > 0) transform.push(`scale(${zoomAt(effect, p, time)})`);
    if (effect.kind === "spin" && amount > 0) {
      const spin = spinAt(effect, p, time, doc);
      transform.push(`scale(${spin.zoom}) rotate(${spin.angle}deg)`);
    }
    if (effect.kind === "glitch" && amount > 0) {
      const glitch = glitchAt(effect, p, time);
      if (glitch.on) {
        filters.push({ id, kind: "split", dx: Math.max(1, Math.round(amount * glitchSplit * doc.width)) * k });
        filter.push(`url(#${id})`);
        transform.push(`translateX(${glitch.jolt * doc.width * k}px)`);
      }
    }
    const frame = Math.floor(time * doc.fps);
    if (effect.kind === "flash" && amount > 0) overlays.push({ key: c.id, kind: "solid", color: effect.color ?? "#ffffff", alpha: flashAlpha(effect, p, time) });
    if (effect.kind === "vignette" && amount > 0) overlays.push({ key: c.id, kind: "vignette", amount });
    if (effect.kind === "grain" && amount > 0) overlays.push({ key: c.id, kind: "grain", amount, frame });
    if (effect.kind === "oldFilm" && amount > 0) {
      overlays.push({ key: `${c.id}g`, kind: "grain", amount: amount * oldFilmLook.grain, frame });
      overlays.push({ key: `${c.id}v`, kind: "vignette", amount: amount * oldFilmLook.vignette });
      overlays.push({ key: `${c.id}f`, kind: "solid", color: "#000000", alpha: flickerAlpha(amount, p, time) });
    }
    if (effect.kind === "lightLeak" && amount > 0) overlays.push({ key: c.id, kind: "leak", amount, color: effect.color ?? "#ff9a3c", place: p, time });
  }
  // CSS 先应用最右侧的 transform；导出中后一个特效在最外层，因此反转。
  return { filter: filter.join(" "), transform: transform.reverse().join(" "), filters, overlays };
}

/** 揭开转场作为 `w` × `h` 舞台像素画框的 CSS 蒙版：渐变停止点之间透明度线性变化，与公式一致。 */
export function revealMask(reveal: Reveal, w: number, h: number): string {
  if (reveal.kind === "circle") {
    const feather = circleFeather * Math.min(w, h);
    const radius = reveal.e * (Math.hypot(w, h) / 2 + feather);
    return `radial-gradient(circle at 50% 50%, #000 ${radius - feather}px, transparent ${radius}px)`;
  }
  const edge = reveal.e * (1 + wipeFeather);
  const to = { right: "right", left: "left", down: "bottom", up: "top" }[reveal.dir];
  return `linear-gradient(to ${to}, #000 ${(edge - wipeFeather) * 100}%, transparent ${edge * 100}%)`;
}

const vignettes = new Map<string, string>();

/** 低分辨率网格上的暗角 PNG data URL（浏览器拉伸，与 FFmpeg scale 一致）。 */
export function vignetteUrl(doc: Pick<VideoDoc, "width" | "height">, amount: number): string {
  const grid = fxGrid(doc);
  const key = `${grid.w}x${grid.h}:${amount.toFixed(3)}`;
  const hit = vignettes.get(key);
  if (hit) return hit;
  const canvas = Object.assign(document.createElement("canvas"), { width: grid.w, height: grid.h });
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(grid.w, grid.h);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) image.data[(y * grid.w + x) * 4 + 3] = Math.round(255 * vignetteAlpha(amount, (x + 0.5) / grid.w, (y + 0.5) / grid.h));
  }
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  if (vignettes.size > 50) vignettes.clear();
  vignettes.set(key, url);
  return url;
}

/** 在低分辨率网格上绘制 `time` 时的漏光（以 screen 叠加）。 */
export function drawLeak(canvas: HTMLCanvasElement, doc: Pick<VideoDoc, "width" | "height">, overlay: Extract<FxOverlay, { kind: "leak" }>) {
  const grid = fxGrid(doc);
  if (canvas.width !== grid.w) canvas.width = grid.w;
  if (canvas.height !== grid.h) canvas.height = grid.h;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(grid.w, grid.h);
  const [r, g, b] = [1, 3, 5].map(index => parseInt(overlay.color.slice(index, index + 2), 16) || 0) as [number, number, number];
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const level = leakLevel(overlay.amount, overlay.place, overlay.time, (x + 0.5) / grid.w, (y + 0.5) / grid.h);
      const index = (y * grid.w + x) * 4;
      image.data[index] = r * level;
      image.data[index + 1] = g * level;
      image.data[index + 2] = b * level;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

/** 预先生成并循环使用的噪点帧数。 */
const grainFrames = 6;
const grains = new Map<string, ImageData[]>();

/** 第 `frame` 帧的胶片颗粒：灰度 128 ± amount × grainMax / 2 的均匀噪点，网格为画面一半，以 overlay 叠加；与导出相似而非逐像素一致。 */
export function drawGrain(canvas: HTMLCanvasElement, doc: Pick<VideoDoc, "width" | "height">, amount: number, frame: number) {
  const w = Math.max(2, Math.round(doc.width / 4) * 2);
  const h = Math.max(2, Math.round(doc.height / 4) * 2);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const spread = Math.round(amount * grainMax) / 2;
  const key = `${w}x${h}:${spread}`;
  let frames = grains.get(key);
  if (!frames) {
    frames = Array.from({ length: grainFrames }, () => {
      const image = new ImageData(w, h);
      for (let index = 0; index < image.data.length; index += 4) {
        const value = 128 + (Math.random() * 2 - 1) * spread;
        image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
        image.data[index + 3] = 255;
      }
      return image;
    });
    if (grains.size > 6) grains.clear();
    grains.set(key, frames);
  }
  canvas.getContext("2d")!.putImageData(frames[((frame % grainFrames) + grainFrames) % grainFrames]!, 0, 0);
}
