<template>
  <fieldRow label="调色预设" kind="pick" :value="look" :options="lookOptions" @change="value => value !== 'custom' && set(lookPatch(value))" />
  <fieldRow label="亮度" kind="range" :value="clip.brightness ?? 1" :min="0" :max="2" :step="0.01" :history="history" :format="percent" @live="value => live({ brightness: value === 1 ? undefined : value })" />
  <fieldRow label="对比度" kind="range" :value="clip.contrast ?? 1" :min="0" :max="2" :step="0.01" :history="history" :format="percent" @live="value => live({ contrast: value === 1 ? undefined : value })" />
  <fieldRow label="饱和度" kind="range" :value="clip.saturation ?? 1" :min="0" :max="3" :step="0.01" :history="history" :format="percent" @live="value => live({ saturation: value === 1 ? undefined : value })" />
  <fieldRow label="色相" kind="range" :value="clip.hue ?? 0" :min="-180" :max="180" :step="1" :history="history" :format="value => `${value}°`" @live="value => live({ hue: value || undefined })" />
  <fieldRow label="棕褐" kind="range" :value="clip.sepia ?? 0" :min="0" :max="1" :step="0.01" :history="history" :format="percent" @live="value => live({ sepia: value || undefined })" />
  <fieldRow label="黑白" kind="range" :value="clip.grayscale ?? 0" :min="0" :max="1" :step="0.01" :history="history" :format="percent" @live="value => live({ grayscale: value || undefined })" />
  <fieldRow label="模糊" kind="range" :value="clip.blur ?? 0" :min="0" :max="40" :step="0.5" :history="history" :format="value => (value ? `${value}px` : translate('无'))" @live="value => live({ blur: value || undefined })" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { VideoClip, VideoDoc } from "../types";
import type { History } from "../useHistory";
import { lookOf, lookPatch, looks } from "../presets";
import { patchClips } from "../timeline";
import fieldRow from "./fieldRow.vue";

// 调色预设、亮度、对比度、饱和度、色相、棕褐、黑白与模糊；片段与调整图层共用。
const props = defineProps<{ clip: VideoClip; history: History<VideoDoc> }>();
const look = computed(() => lookOf(props.clip));
const lookOptions = computed(() => [...Object.entries(looks).map(([value, item]) => ({ value, label: translate(item.label) })), ...(look.value === "custom" ? [{ value: "custom", label: translate("自定义") }] : [])]);
const set = (patch: Partial<VideoClip>) => props.history.set(patchClips(props.history.content.value, [props.clip.id], patch));
const live = (patch: Partial<VideoClip>) => props.history.live(patchClips(props.history.content.value, [props.clip.id], patch));
const percent = (value: number) => `${Math.round(value * 100)}%`;
</script>
