// 剪辑工程的数据结构：时间线、轨道、片段、文字与标记。媒体路径均为工作区内的相对路径。

export type VideoTrackKind = "video" | "audio" | "text";

/**
 * 时间线上的一行。`doc.tracks` 按显示顺序自上而下排列（文字、V3、V2、V1、A1、A2），越靠上的视频轨越靠前绘制。
 * 恰好一条视频轨是 `magnetic`（V1）：其片段首尾相接，`start` 由计算得出；其余轨道按 `start` 摆放。
 */
export interface VideoTrack {
  id: string;
  kind: VideoTrackKind;
  name: string;
  magnetic?: boolean;
  hidden?: boolean;
  muted?: boolean;
  locked?: boolean;
}

/** 其他比例的片段如何填满画面：留黑边、裁切铺满，或叠在模糊背景上。 */
export type VideoFit = "fit" | "fill" | "blur";
export type VideoTransitionKind =
  | "dissolve" | "dipBlack" | "dipWhite" | "flash" | "leak" | "whip" | "blink" | "wipe" | "push" | "slide" | "zoom" | "circle" | "glitch" | "spin";
export type VideoDirection = "left" | "right" | "up" | "down";

/** 片段画框内的比例（0–1）。 */
export interface VideoRect { x: number; y: number; w: number; h: number }

/**
 * 轨道上的一段源文件。时间单位为秒，`in`/`out` 为文件内时间；片段在时间线上持续 (out − in) / speed（图片为 out − in）。
 * `x`/`y` 为中心点在画面中的比例，`scale` 在 `fit` 计算出的尺寸上再缩放。
 */
export interface VideoClip {
  id: string;
  track: string;
  kind: "video" | "image" | "audio" | "effect";
  src: string;
  name: string;
  in: number;
  out: number;
  srcDuration?: number;
  width?: number;
  height?: number;
  start?: number;
  speed?: number;
  volume?: number;
  muted?: boolean;
  audioFadeIn?: number;
  audioFadeOut?: number;
  fit?: VideoFit;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  moveTo?: { x: number; y: number };
  kenBurns?: { from: { zoom: number; x: number; y: number }; to: { zoom: number; x: number; y: number } };
  opacity?: number;
  crop?: { left: number; top: number; right: number; bottom: number };
  mask?: VideoRect & { shape: VideoMaskShape; feather: number; invert?: boolean; angle?: number; text?: string };
  brightness?: number;
  contrast?: number;
  saturation?: number;
  fadeIn?: number;
  fadeOut?: number;
  transition?: { kind: VideoTransitionKind; duration: number; direction?: VideoDirection };
  hue?: number;
  sepia?: number;
  grayscale?: number;
  blur?: number;
  keys?: VideoKeys;
  hidden?: boolean;
  blend?: VideoBlend;
  border?: { width: number; color: string };
  effect?: VideoEffect;
}

/** 特效片段（调整图层）：放在非磁性视频轨上，持续期间改变其下所有轨道的画面。 */
export type VideoEffectKind = "adjust" | "shake" | "flash" | "vignette" | "grain" | "oldFilm" | "glitch" | "lightLeak" | "dirBlur" | "zoom" | "spin";
export interface VideoEffect {
  kind: VideoEffectKind;
  amount: number;
  color?: string;
  direction?: "horizontal" | "vertical";
  steady?: boolean;
}

export type VideoKeyProp = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";
/** 关键帧到下一帧的插值：直线（默认）、保持或缓动。 */
export type VideoEase = "linear" | "hold" | "in" | "out" | "inOut";
/** `t`：相对片段起点的秒数。 */
export interface VideoKeyframe { t: number; v: number; ease?: VideoEase }
export type VideoKeys = Partial<Record<VideoKeyProp, VideoKeyframe[]>>;

export type VideoMaskShape = "split" | "bars" | "rect" | "ellipse" | "heart" | "diamond" | "star" | "triangle" | "text";

/** 预览（CSS mix-blend-mode）与导出（FFmpeg blend）都能实现的混合模式。 */
export type VideoBlend = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "color-dodge" | "color-burn" | "hard-light" | "soft-light" | "difference" | "exclusion" | "plus-lighter";

/** 文字轨上的图形或贴纸：中心为样式的 x / y，尺寸为画面比例。 */
export interface VideoShape {
  kind: "rect" | "ellipse" | "triangle" | "polygon" | "star" | "heart" | "line";
  w: number;
  h: number;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  radius?: number;
  sides?: number;
  rotation?: number;
}

export interface VideoTextStyle {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  stroke: string;
  strokeWidth: number;
  background: string;
  backgroundOpacity: number;
  shadow: boolean;
  align: "left" | "center" | "right";
  x: number;
  y: number;
  maxWidth: number;
  letterSpacing?: number;
  lineHeight?: number;
  decoration?: "underline" | "line-through";
}

export type VideoTextMotion = "up" | "down" | "left" | "right";

export interface VideoText {
  id: string;
  track: string;
  text: string;
  start: number;
  duration: number;
  style: VideoTextStyle;
  fadeIn?: number;
  fadeOut?: number;
  motionIn?: VideoTextMotion;
  motionOut?: VideoTextMotion;
  wipeIn?: number;
  wipeOut?: number;
  shape?: VideoShape;
  hidden?: boolean;
}

export interface VideoMarker {
  id: string;
  time: number;
  label: string;
}

export interface VideoDoc {
  version: 2;
  width: number;
  height: number;
  fps: number;
  background: string;
  tracks: VideoTrack[];
  clips: VideoClip[];
  texts: VideoText[];
  markers: VideoMarker[];
}

/** 导出选项：默认导出整条时间线为 MP4。 */
export interface VideoExportOptions {
  format?: "mp4" | "gif" | "mp3" | "wav";
  audioTracks?: string[];
  shownTracks?: string[];
  quality?: "high" | "medium" | "small";
  scale?: number;
  range?: { start: number; end: number };
}

export interface VideoStrip { count: number; width: number; height: number; duration: number; image: string }
