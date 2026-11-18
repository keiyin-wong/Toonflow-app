// 标题、字幕、图形与贴纸的绘制。同一函数既绘制预览，也绘制导出叠加的 PNG，所见即所得。

import type { VideoShape, VideoText } from "./types";
import { hasContent } from "./videoModel";

const fallbackFonts = `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif`;

/** 按 `max` 像素折行：有空格处在空格断开，中日韩文字可在任意处断开。 */
function wrap(context: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      const next = line + char;
      if (line && context.measureText(next).width > max) {
        const space = line.lastIndexOf(" ");
        if (char !== " " && space > 0) {
          lines.push(line.slice(0, space));
          line = line.slice(space + 1) + char;
        } else {
          lines.push(line);
          line = char === " " ? "" : char;
        }
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** 带透明度的 `#rrggbb`，用于文字底框。 */
const withAlpha = (hex: string, alpha: number) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  const value = match ? parseInt(match[1]!, 16) : 0;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/** 画面像素坐标的矩形。 */
export interface TextBox { x: number; y: number; w: number; h: number }

/** 以 (0, 0) 为中心、`w`×`h` 像素的图形路径。 */
function shapePath(context: CanvasRenderingContext2D, shape: VideoShape, w: number, h: number) {
  const [rx, ry] = [w / 2, h / 2];
  context.beginPath();
  switch (shape.kind) {
    case "rect":
      context.roundRect(-rx, -ry, w, h, (shape.radius ?? 0) * Math.min(w, h));
      break;
    case "ellipse":
      context.ellipse(0, 0, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
      break;
    case "triangle":
      context.moveTo(0, -ry);
      context.lineTo(rx, ry);
      context.lineTo(-rx, ry);
      context.closePath();
      break;
    case "polygon":
    case "star": {
      const sides = Math.max(3, shape.sides ?? (shape.kind === "star" ? 5 : 6));
      const steps = shape.kind === "star" ? sides * 2 : sides;
      for (let index = 0; index < steps; index++) {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / steps;
        const radius = shape.kind === "star" && index % 2 ? 0.45 : 1;
        if (index) context.lineTo(Math.cos(angle) * rx * radius, Math.sin(angle) * ry * radius);
        else context.moveTo(Math.cos(angle) * rx * radius, Math.sin(angle) * ry * radius);
      }
      context.closePath();
      break;
    }
    case "heart":
      context.moveTo(0, ry);
      context.bezierCurveTo(-rx * 1.6, -ry * 0.1, -rx * 0.55, -ry * 1.25, 0, -ry * 0.45);
      context.bezierCurveTo(rx * 0.55, -ry * 1.25, rx * 1.6, -ry * 0.1, 0, ry);
      context.closePath();
      break;
    case "line":
      context.moveTo(-rx, -ry);
      context.lineTo(rx, ry);
      break;
  }
}

/** 以 (cx, cy) 为中心绘制图形，返回覆盖范围。 */
function drawShape(context: CanvasRenderingContext2D, shape: VideoShape, cx: number, cy: number, width: number, height: number): TextBox {
  const w = shape.w * width;
  const h = shape.h * height;
  const lineWidth = shape.strokeWidth * Math.min(width, height);
  context.save();
  context.translate(cx, cy);
  if (shape.rotation) context.rotate((shape.rotation * Math.PI) / 180);
  shapePath(context, shape, w, h);
  if (shape.fillOpacity > 0 && shape.kind !== "line") {
    context.fillStyle = withAlpha(shape.fill, shape.fillOpacity);
    context.fill();
  }
  if (lineWidth > 0) {
    context.lineWidth = lineWidth;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.strokeStyle = shape.stroke;
    context.stroke();
  }
  context.restore();
  const angle = ((shape.rotation ?? 0) * Math.PI) / 180;
  const boxWidth = Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle)) + lineWidth;
  const boxHeight = Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle)) + lineWidth;
  return { x: cx - boxWidth / 2, y: cy - boxHeight / 2, w: boxWidth, h: boxHeight };
}

const union = (a: TextBox, b: TextBox): TextBox => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** 在画面大小（`width`×`height`）的画布上绘制一个文字项（文字、图形或带字图形），返回覆盖范围。 */
export function drawText(context: CanvasRenderingContext2D, text: VideoText, width: number, height: number): TextBox {
  const style = text.style;
  const shapeBox = text.shape ? drawShape(context, text.shape, style.x * width, style.y * height, width, height) : null;
  if (shapeBox && !text.text.trim()) return shapeBox;
  const size = Math.max(6, (style.size / 100) * height);
  context.save();
  context.font = `${style.italic ? "italic " : ""}${style.bold ? 700 : 400} ${size}px "${style.font}", ${fallbackFonts}`;
  context.letterSpacing = style.letterSpacing ? `${(size * style.letterSpacing) / 100}px` : "0px";
  context.textBaseline = "middle";
  context.textAlign = style.align;
  const lines = wrap(context, text.text, Math.max(size, style.maxWidth * width));
  const lineHeight = size * (style.lineHeight ?? 1.3);
  const blockHeight = lines.length * lineHeight;
  const blockWidth = Math.max(...lines.map(line => context.measureText(line).width), 1);
  const cx = style.x * width;
  const top = style.y * height - blockHeight / 2;
  const left = cx - blockWidth / 2;
  const anchor = style.align === "left" ? left : style.align === "right" ? left + blockWidth : cx;
  const pad = size * 0.3;
  if (style.backgroundOpacity > 0) {
    context.fillStyle = withAlpha(style.background, style.backgroundOpacity);
    context.beginPath();
    context.roundRect(left - pad * 1.4, top - pad, blockWidth + pad * 2.8, blockHeight + pad * 2, size * 0.22);
    context.fill();
  }
  lines.forEach((line, index) => {
    const y = top + lineHeight * (index + 0.5);
    if (style.strokeWidth > 0) {
      context.lineJoin = "round";
      context.lineWidth = (size * style.strokeWidth) / 100;
      context.strokeStyle = style.stroke;
      context.strokeText(line, anchor, y);
    }
    if (style.shadow) {
      context.shadowColor = "rgba(0, 0, 0, 0.65)";
      context.shadowBlur = size * 0.18;
      context.shadowOffsetY = size * 0.06;
    }
    context.fillStyle = style.color;
    context.fillText(line, anchor, y);
    context.shadowColor = "transparent";
    if (style.decoration && line) {
      const lineWidth = context.measureText(line).width;
      const x0 = style.align === "left" ? anchor : style.align === "right" ? anchor - lineWidth : anchor - lineWidth / 2;
      const thickness = Math.max(1, size * 0.06);
      context.fillRect(x0, y + (style.decoration === "underline" ? size * 0.42 : 0) - thickness / 2, lineWidth, thickness);
    }
  });
  context.restore();
  const box = { x: left - pad * 1.4, y: top - pad, w: blockWidth + pad * 2.8, h: blockHeight + pad * 2 };
  return shapeBox ? union(shapeBox, box) : box;
}

/** 导出用：文字单独绘制在透明画面上的 PNG。 */
export function textPng(text: VideoText, width: number, height: number): Promise<Blob | null> {
  if (!hasContent(text) || text.hidden) return Promise.resolve(null);
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  drawText(context, text, width, height);
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

let scratch: CanvasRenderingContext2D | null = null;

/** 文字位置（预览选框与拖动）：在 1×1 画布上绘制以测量。 */
export function measureText(text: VideoText, width: number, height: number): TextBox {
  scratch ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d")!;
  return drawText(scratch, text, width, height);
}
