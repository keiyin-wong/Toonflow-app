// 剪辑面板界面显示用的名称，显示时用 translate() 翻译。

import { msg } from "@toonflow/i18n/vue";
import type { VideoBlend, VideoDirection, VideoEase, VideoEffectKind, VideoMaskShape, VideoShape, VideoTextMotion, VideoTransitionKind } from "./types";

export const blendLabels: Record<VideoBlend, ReturnType<typeof msg>> = {
  normal: msg`正常`, multiply: msg`正片叠底`, screen: msg`滤色`, overlay: msg`叠加`, darken: msg`变暗`, lighten: msg`变亮`, "color-dodge": msg`颜色减淡`,
  "color-burn": msg`颜色加深`, "hard-light": msg`强光`, "soft-light": msg`柔光`, difference: msg`差值`, exclusion: msg`排除`, "plus-lighter": msg`相加`,
};
export const easeLabels: Record<VideoEase, ReturnType<typeof msg>> = { linear: msg`线性`, hold: msg`保持`, in: msg`缓入`, out: msg`缓出`, inOut: msg`缓入缓出` };
export const maskLabels: Record<VideoMaskShape, ReturnType<typeof msg>> = {
  split: msg`分割`, bars: msg`电影黑边`, rect: msg`矩形`, ellipse: msg`椭圆`, heart: msg`心形`, diamond: msg`菱形`, star: msg`星形`, triangle: msg`三角形`, text: msg`文字`,
};
export const shapeLabels: Record<VideoShape["kind"], ReturnType<typeof msg>> = {
  rect: msg`矩形`, ellipse: msg`椭圆`, triangle: msg`三角形`, polygon: msg`多边形`, star: msg`星形`, heart: msg`心形`, line: msg`直线`,
};
export const effectLabels: Record<VideoEffectKind, ReturnType<typeof msg>> = {
  adjust: msg`调整图层`, shake: msg`镜头抖动`, flash: msg`闪光`, vignette: msg`暗角`, grain: msg`胶片颗粒`, oldFilm: msg`老电影`,
  glitch: msg`故障`, lightLeak: msg`漏光`, dirBlur: msg`方向模糊`, zoom: msg`缩放`, spin: msg`旋转`,
};
export const effectHints: Partial<Record<VideoEffectKind, ReturnType<typeof msg>>> = {
  adjust: msg`用下方滑块改变其下所有画面的颜色（和模糊）。`,
  shake: msg`画面抖动的幅度；会略微放大以免露出边缘。`,
  flash: msg`闪光峰值亮度：开头迅速升起，结束前淡出。`,
  vignette: msg`四角变暗的程度。`,
  grain: msg`胶片颗粒的强度。`,
  oldFilm: msg`棕褐色、颗粒、暗角与闪烁的组合。`,
  glitch: msg`红蓝通道分离的距离，间歇爆发并横向抖动。`,
  lightLeak: msg`暖色漏光的亮度，随特效时长膨胀消退。`,
  dirBlur: msg`模糊的长度，适合两镜头间的甩镜。`,
};
export const transitionLabels: Record<VideoTransitionKind, ReturnType<typeof msg>> = {
  dissolve: msg`交叉叠化`, dipBlack: msg`闪黑`, dipWhite: msg`闪白`, flash: msg`闪光（回忆）`, leak: msg`漏光`, blink: msg`眨眼（醒来）`,
  whip: msg`甩镜`, push: msg`推入`, slide: msg`滑入`, wipe: msg`擦除`, circle: msg`圆形展开`, zoom: msg`缩放`, spin: msg`旋转`, glitch: msg`故障`,
};
export const directionLabels: Record<VideoDirection, ReturnType<typeof msg>> = { left: msg`向左`, right: msg`向右`, up: msg`向上`, down: msg`向下` };
export const motionLabels: Record<VideoTextMotion | "none", ReturnType<typeof msg>> = { none: msg`无`, up: msg`向上 ↑`, down: msg`向下 ↓`, left: msg`向左 ←`, right: msg`向右 →` };
export const fitLabels = { fit: msg`适应（黑边）`, fill: msg`填充（裁切）`, blur: msg`适应 + 模糊背景` };
export const kenBurnsLabels: Record<string, ReturnType<typeof msg>> = {
  none: msg`无`, zoomIn: msg`推近`, zoomOut: msg`拉远`, panLeft: msg`向左平移`, panRight: msg`向右平移`, panUp: msg`向上平移`, panDown: msg`向下平移`, custom: msg`自定义`,
};
