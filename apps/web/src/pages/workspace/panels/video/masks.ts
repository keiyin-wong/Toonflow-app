// 片段的可见部分：裁切、蒙版（形状、羽化、反转）与不透明度，绘制成片段画框大小的一张图。
// 预览将其作为 CSS 蒙版（透明度），导出得到相同绘制的灰度图（白色为显示）供 FFmpeg alphamerge 使用。

import type { VideoClip, VideoDoc } from "./types";
import { boxSize, isKeyed, needsMask } from "./videoModel";

const cache = new Map<string, string>();

function draw(doc: VideoDoc, clip: VideoClip, mode: "alpha" | "grey"): HTMLCanvasElement {
  const { w, h } = boxSize(doc, clip);
  // 大画框缩小绘制：蒙版本就会拉伸到画框，柔边不需要这么多像素。
  const factor = Math.min(1, 1600 / Math.max(w, h));
  const canvasWidth = Math.max(2, Math.round(w * factor));
  const canvasHeight = Math.max(2, Math.round(h * factor));
  const canvas = Object.assign(document.createElement("canvas"), { width: canvasWidth, height: canvasHeight });
  const context = canvas.getContext("2d")!;
  if (mode === "grey") {
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvasWidth, canvasHeight);
  }
  const crop = clip.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const cropX = crop.left * canvasWidth;
  const cropY = crop.top * canvasHeight;
  const cropWidth = Math.max(0, canvasWidth * (1 - crop.left - crop.right));
  const cropHeight = Math.max(0, canvasHeight * (1 - crop.top - crop.bottom));
  const shown = Object.assign(document.createElement("canvas"), { width: canvasWidth, height: canvasHeight });
  const layer = shown.getContext("2d")!;
  layer.fillStyle = "#fff";
  const mask = clip.mask;
  if (!mask) layer.fillRect(cropX, cropY, cropWidth, cropHeight);
  else {
    const shape = () => {
      const [x, y, width, height] = [mask.x * canvasWidth, mask.y * canvasHeight, mask.w * canvasWidth, mask.h * canvasHeight];
      const [mx, my] = [x + width / 2, y + height / 2];
      layer.beginPath();
      if (mask.shape === "text") {
        // 文字尽量填满矩形（粗体居中），片段透过字形显示。
        const words = mask.text?.trim() || "TEXT";
        layer.font = `900 ${Math.max(4, height)}px "Arial Black", "Microsoft YaHei", sans-serif`;
        const fit = Math.min(1, width / Math.max(1, layer.measureText(words).width));
        layer.font = `900 ${Math.max(4, height * fit)}px "Arial Black", "Microsoft YaHei", sans-serif`;
        layer.textAlign = "center";
        layer.textBaseline = "middle";
        layer.fillText(words, mx, my);
        return;
      }
      if (mask.shape === "split") {
        // 穿过中心、顺时针转 `angle` 的直线左侧。
        const angle = ((mask.angle ?? 0) * Math.PI) / 180;
        const far = 4 * Math.max(canvasWidth, canvasHeight);
        const [dx, dy] = [Math.sin(angle) * far, -Math.cos(angle) * far];
        const [nx, ny] = [-Math.cos(angle) * far, -Math.sin(angle) * far];
        layer.moveTo(mx + dx, my + dy);
        layer.lineTo(mx + dx + nx, my + dy + ny);
        layer.lineTo(mx - dx + nx, my - dy + ny);
        layer.lineTo(mx - dx, my - dy);
      } else if (mask.shape === "bars") layer.rect(-canvasWidth, y, canvasWidth * 3, height);
      else if (mask.shape === "ellipse") layer.ellipse(mx, my, Math.max(1, width / 2), Math.max(1, height / 2), 0, 0, Math.PI * 2);
      else if (mask.shape === "diamond") {
        layer.moveTo(mx, y);
        layer.lineTo(x + width, my);
        layer.lineTo(mx, y + height);
        layer.lineTo(x, my);
      } else if (mask.shape === "triangle") {
        layer.moveTo(mx, y);
        layer.lineTo(x + width, y + height);
        layer.lineTo(x, y + height);
      } else if (mask.shape === "star") {
        for (let index = 0; index < 10; index++) {
          const angle = -Math.PI / 2 + (index * Math.PI) / 5;
          const radius = index % 2 ? 0.45 : 1;
          if (index) layer.lineTo(mx + (Math.cos(angle) * width * radius) / 2, my + (Math.sin(angle) * height * radius) / 2);
          else layer.moveTo(mx + (Math.cos(angle) * width * radius) / 2, my + (Math.sin(angle) * height * radius) / 2);
        }
      } else if (mask.shape === "heart") {
        layer.moveTo(mx, y + height);
        layer.bezierCurveTo(mx - width * 0.8, my - height * 0.05, mx - width * 0.275, y - height * 0.125, mx, y + height * 0.275);
        layer.bezierCurveTo(mx + width * 0.275, y - height * 0.125, mx + width * 0.8, my - height * 0.05, mx, y + height);
      } else layer.rect(x, y, width, height);
      layer.closePath();
    };
    const feather = mask.feather * Math.min(canvasWidth, canvasHeight);
    if (mask.invert) {
      layer.fillRect(0, 0, canvasWidth, canvasHeight);
      layer.globalCompositeOperation = "destination-out";
    }
    layer.filter = feather > 0 ? `blur(${feather / 2}px)` : "none";
    shape();
    layer.fill();
    layer.filter = "none";
    // 只保留裁切后剩下的部分。
    layer.globalCompositeOperation = "destination-in";
    layer.fillRect(cropX, cropY, cropWidth, cropHeight);
  }
  // 关键帧不透明度逐帧应用，不画进蒙版。
  context.globalAlpha = isKeyed(clip, "opacity") ? 1 : clip.opacity ?? 1;
  context.drawImage(shown, 0, 0);
  return canvas;
}

const keyOf = (doc: VideoDoc, clip: VideoClip, mode: string) => JSON.stringify([mode, boxSize(doc, clip), clip.crop, clip.mask, clip.opacity]);

/** 预览 CSS 蒙版的 data URL；整段可见时为 null。羽化绘制有开销，结果会缓存。 */
export function maskUrl(doc: VideoDoc, clip: VideoClip): string | null {
  if (!needsMask(clip)) return null;
  const key = keyOf(doc, clip, "alpha");
  let url = cache.get(key);
  if (!url) {
    url = draw(doc, clip, "alpha").toDataURL("image/png");
    if (cache.size > 200) cache.clear();
    cache.set(key, url);
  }
  return url;
}

/** 导出用灰度蒙版 PNG。 */
export const maskPng = (doc: VideoDoc, clip: VideoClip) => new Promise<Blob | null>(resolve => draw(doc, clip, "grey").toBlob(resolve, "image/png"));
