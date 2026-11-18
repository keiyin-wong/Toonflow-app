// 一键调色与文字预设：属性面板的调色列表与素材面板的文字、特效页共用。

import { msg } from "@toonflow/i18n/vue";
import type { VideoClip, VideoTextStyle } from "./types";
import { subtitleStyle, titleStyle } from "./videoModel";

type LookValues = Partial<Pick<VideoClip, "brightness" | "contrast" | "saturation" | "hue" | "sepia" | "grayscale">>;

/** 调色预设：未列出的调色值恢复默认。 */
export const looks: Record<string, { label: ReturnType<typeof msg>; values: LookValues }> = {
  none: { label: msg`无`, values: {} },
  blackWhite: { label: msg`黑白`, values: { grayscale: 1, contrast: 1.1 } },
  noir: { label: msg`黑色电影`, values: { grayscale: 1, contrast: 1.4, brightness: 0.9 } },
  sepia: { label: msg`棕褐`, values: { sepia: 0.8 } },
  vintage: { label: msg`复古`, values: { sepia: 0.35, contrast: 0.9, saturation: 0.8, brightness: 1.05 } },
  warm: { label: msg`暖色`, values: { sepia: 0.25, saturation: 1.15, hue: -8 } },
  cool: { label: msg`冷色`, values: { hue: 12, saturation: 0.9, brightness: 1.03 } },
  vivid: { label: msg`鲜艳`, values: { saturation: 1.4, contrast: 1.1 } },
  faded: { label: msg`褪色`, values: { contrast: 0.8, brightness: 1.1, saturation: 0.7 } },
  dramatic: { label: msg`戏剧`, values: { contrast: 1.35, saturation: 0.85, brightness: 0.95 } },
};
export const lookKeys = ["brightness", "contrast", "saturation", "hue", "sepia", "grayscale"] as const;

/** 调色预设对应的片段补丁：列出的取预设值，其余恢复默认。 */
export const lookPatch = (name: string): Partial<VideoClip> => Object.fromEntries(lookKeys.map(key => [key, looks[name]?.values[key]]));

/** 片段调色匹配的预设名，不匹配为 `custom`。 */
export function lookOf(clip: VideoClip) {
  const neutral = (key: typeof lookKeys[number]) => (key === "hue" || key === "sepia" || key === "grayscale" ? 0 : 1);
  return Object.entries(looks).find(([, look]) => lookKeys.every(key => (clip[key] ?? neutral(key)) === (look.values[key] ?? neutral(key))))?.[0] ?? "custom";
}

/** 文字预设。 */
export const textPresets: { label: ReturnType<typeof msg>; text: string; style: VideoTextStyle }[] = [
  { label: msg`字幕`, text: "字幕", style: subtitleStyle },
  { label: msg`标题`, text: "标题", style: titleStyle },
  { label: msg`大标题`, text: "大标题", style: { ...titleStyle, size: 9, y: 0.5, letterSpacing: 4 } },
  { label: msg`底框文字`, text: "底框文字", style: { ...subtitleStyle, strokeWidth: 0, backgroundOpacity: 0.6 } },
  { label: msg`黄色字幕`, text: "字幕", style: { ...subtitleStyle, color: "#ffe14d" } },
  { label: msg`人名条`, text: "姓名\n身份介绍", style: { ...subtitleStyle, size: 3.4, align: "left", x: 0.32, y: 0.74, strokeWidth: 0, backgroundOpacity: 0.7, background: "#1d4ed8" } },
  { label: msg`描边`, text: "OUTLINE", style: { ...titleStyle, color: "#000000", stroke: "#ffffff", strokeWidth: 10, shadow: false, y: 0.5 } },
  { label: msg`下划线`, text: "下划线", style: { ...subtitleStyle, strokeWidth: 0, shadow: true, decoration: "underline", y: 0.5 } },
  { label: msg`宽字距`, text: "宽 字 距", style: { ...titleStyle, size: 5, letterSpacing: 30, y: 0.5, bold: false } },
];
