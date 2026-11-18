<template>
  <div class="inspectorHead">工程设置</div>
  <div class="inspectorScroll">
    <inspectorSection title="画面">
      <fieldRow label="尺寸" kind="pick" :value="presetValue" :options="presetOptions" @change="pickPreset" />
      <fieldRow label="宽" kind="number" suffix="px" :step="2" :min="16" :value="doc.width" @change="value => history.set({ ...doc, width: Math.round(value / 2) * 2 })" />
      <fieldRow label="高" kind="number" suffix="px" :step="2" :min="16" :value="doc.height" @change="value => history.set({ ...doc, height: Math.round(value / 2) * 2 })" />
      <fieldRow label="帧率" kind="pick" :value="doc.fps" :options="fpsOptions" @change="value => history.set({ ...doc, fps: value })" />
      <fieldRow label="背景色" kind="color" :value="doc.background" :history="history" @live="value => history.live({ ...history.content.value, background: value })" />
    </inspectorSection>
    <div class="inspectorTop itemMeta">时长 {{ timecode(docLength(doc), doc.fps) }} · {{ doc.clips.length }} 个片段 · {{ doc.texts.length }} 条文字 · {{ doc.tracks.length }} 条轨道</div>
    <p class="fieldHint padded">选中片段可调整运动、Ken Burns、蒙版、裁切、调色、淡入淡出、转场、速度与音频；选中文字可调整字体与位置。16:9 片段放进 9:16 视频时，建议使用“适应 + 模糊背景”或“填充”。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { VideoDoc } from "../types";
import type { History } from "../useHistory";
import { docLength, framePresets, timecode } from "../timeline";
import fieldRow from "./fieldRow.vue";
import inspectorSection from "./inspectorSection.vue";

// 未选中内容时：工程的画面尺寸、帧率与背景色。
const props = defineProps<{ history: History<VideoDoc> }>();
const doc = computed(() => props.history.content.value);
const preset = computed(() => framePresets.find(item => item.width === doc.value.width && item.height === doc.value.height));
const presetValue = computed(() => (preset.value ? `${preset.value.width}x${preset.value.height}` : "custom"));
const presetOptions = computed(() => [...(preset.value ? [] : [{ value: "custom", label: `${doc.value.width}×${doc.value.height}` }]), ...framePresets.map(item => ({ value: `${item.width}x${item.height}`, label: item.label }))]);
const fpsOptions = [24, 25, 30, 50, 60].map(fps => ({ value: fps, label: `${fps} fps` }));

function pickPreset(value: string) {
  const [width, height] = value.split("x").map(Number);
  if (width && height) props.history.set({ ...doc.value, width, height });
}
</script>
