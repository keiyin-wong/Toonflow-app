<template>
  <div v-if="!mask" class="maskEmpty">
    <icon-mask :size="32" stroke="1.4" aria-hidden="true" />
    <b>没有蒙版</b>
    <span>添加蒙版以隐藏或显示片段的一部分。</span>
  </div>
  <div v-else class="fieldRow">
    <span class="fieldLabel">形状</span>
    <b class="maskName"><maskIcon :shape="mask.shape" /> {{ translate(maskLabels[mask.shape]) }}</b>
    <span />
  </div>
  <el-dropdown trigger="click" @command="pickShape">
    <el-button :type="mask ? 'default' : 'primary'" size="small">{{ mask ? translate("更换形状") : translate("添加蒙版") }}</el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item v-for="shape in maskShapes" :key="shape" :command="shape"><maskIcon :shape="shape" />&nbsp;{{ translate(maskLabels[shape]) }}</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
  <template v-if="mask">
    <label v-if="mask.shape === 'text'" class="fieldRow">
      <span class="fieldLabel">文字</span>
      <el-input :modelValue="mask.text ?? ''" size="small" @focus="history.begin()" @blur="history.end()" @keydown.stop @input="value => live({ text: value })" />
      <span />
    </label>
    <template v-if="mask.shape === 'split'">
      <fieldRow label="位置" kind="range" :value="mask.x + mask.w / 2" :min="0" :max="1" :step="0.005" :history="history" :format="percent" @live="value => live({ x: value - mask!.w / 2 })" />
      <fieldRow label="角度" kind="range" :value="mask.angle ?? 0" :min="-90" :max="90" :step="1" :history="history" :format="value => `${Math.round(value)}°`" @live="value => live({ angle: value || undefined })" />
    </template>
    <template v-else-if="mask.shape === 'bars'">
      <fieldRow label="上黑边" kind="range" :value="mask.y" :min="0" :max="0.45" :step="0.005" :history="history" :format="percent" @live="value => live({ y: value, h: Math.max(0.05, mask!.y + mask!.h - value) })" />
      <fieldRow label="下黑边" kind="range" :value="1 - mask.y - mask.h" :min="0" :max="0.45" :step="0.005" :history="history" :format="percent" @live="value => live({ h: Math.max(0.05, 1 - value - mask!.y) })" />
    </template>
    <template v-else>
      <fieldRow label="左" kind="range" :value="mask.x" :min="0" :max="1" :step="0.005" :history="history" :format="percent" @live="value => live({ x: value })" />
      <fieldRow label="上" kind="range" :value="mask.y" :min="0" :max="1" :step="0.005" :history="history" :format="percent" @live="value => live({ y: value })" />
      <fieldRow label="宽" kind="range" :value="mask.w" :min="0.01" :max="1" :step="0.005" :history="history" :format="percent" @live="value => live({ w: value })" />
      <fieldRow label="高" kind="range" :value="mask.h" :min="0.01" :max="1" :step="0.005" :history="history" :format="percent" @live="value => live({ h: value })" />
    </template>
    <fieldRow label="羽化" kind="range" :value="mask.feather" :min="0" :max="0.5" :step="0.005" :history="history" :format="percent" @live="value => live({ feather: value })" />
    <el-checkbox :modelValue="!!mask.invert" size="small" @change="value => set({ ...mask!, invert: Boolean(value) || undefined })">反转（隐藏内部）</el-checkbox>
    <el-button size="small" type="danger" plain @click="set(undefined)">移除蒙版</el-button>
  </template>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { VideoClip, VideoDoc, VideoMaskShape } from "../types";
import type { History } from "../useHistory";
import { maskLabels } from "../labels";
import { maskShapes, newMask, patchClips } from "../timeline";
import fieldRow from "./fieldRow.vue";

/** 片段蒙版：没有时显示空状态与“添加蒙版”，有时可调整形状、位置、羽化，以及分割角度或文字蒙版的内容。 */
const props = defineProps<{ clip: VideoClip; history: History<VideoDoc> }>();
const mask = computed(() => props.clip.mask);
const set = (next: VideoClip["mask"]) => props.history.set(patchClips(props.history.content.value, [props.clip.id], { mask: next }));
const live = (patch: Partial<NonNullable<VideoClip["mask"]>>) => props.history.live(patchClips(props.history.content.value, [props.clip.id], clip => ({ mask: { ...clip.mask!, ...patch } })));
const percent = (value: number) => `${Math.round(value * 100)}%`;
const special = (shape: VideoMaskShape) => shape === "split" || shape === "bars" || shape === "text";

function pickShape(shape: VideoMaskShape) {
  const current = mask.value;
  set(current && !special(shape) && !special(current.shape) ? { ...current, shape } : newMask(shape));
}

/** 蒙版形状菜单里的小图标。 */
const maskIcon = defineComponent({
  props: { shape: { type: String as () => VideoMaskShape, required: true } },
  setup(iconProps) {
    const parts: Record<VideoMaskShape, () => ReturnType<typeof h>[]> = {
      split: () => [h("rect", { x: 2, y: 2, width: 12, height: 12, rx: 2 }), h("line", { x1: 8, y1: 2, x2: 8, y2: 14 })],
      bars: () => [h("line", { x1: 2, y1: 8, x2: 14, y2: 8 })],
      rect: () => [h("rect", { x: 2, y: 2, width: 12, height: 12, rx: 2 })],
      ellipse: () => [h("circle", { cx: 8, cy: 8, r: 6 })],
      heart: () => [h("path", { d: "M8 13.5 C2 9.5 2.5 3.5 8 6 C13.5 3.5 14 9.5 8 13.5 Z" })],
      diamond: () => [h("polygon", { points: "8,2 14,8 8,14 2,8" })],
      star: () => [h("polygon", { points: "8,1.8 9.8,6 14,6.3 10.8,9.2 11.8,13.6 8,11.2 4.2,13.6 5.2,9.2 2,6.3 6.2,6" })],
      triangle: () => [h("polygon", { points: "8,2 14,14 2,14" })],
      text: () => [h("text", { x: 8, y: 12, "text-anchor": "middle", "font-size": 10, stroke: "none", fill: "currentColor" }, "Aa")],
    };
    return () => h("svg", { class: "maskIcon", viewBox: "0 0 16 16", "aria-hidden": "true" }, parts[iconProps.shape]());
  },
});
</script>

<style lang="scss">
.maskEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-align: center;
}

.maskName { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }

.maskIcon {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  vertical-align: -2px;
}
</style>
