<template>
  <aside class="videoInspector">
    <nav v-if="groups.length" class="inspectorRail">
      <button v-for="group in groups" :key="group.id" :class="{ active: group.id === activeGroup }" :title="translate(group.label)" @click="picked = group.id">
        <component :is="group.icon" :size="17" />
      </button>
    </nav>
    <div class="inspectorBody">
      <multiFields v-if="selection.length > 1" :history="history" :clips="clips" :texts="texts" />
      <effectFields v-else-if="clips[0]?.kind === 'effect'" :key="clips[0].id" :clip="clips[0]" :history="history" />
      <clipFields v-else-if="clips[0]" :key="clips[0].id" :clip="clips[0]" :history="history" :time="time"
        @seek="value => emit('seek', value)" @detachAudio="id => emit('detachAudio', id)" @freeze="id => emit('freeze', id)" />
      <textFields v-else-if="texts[0]" :key="texts[0].id" :text="texts[0]" :history="history" />
      <projectFields v-else :history="history" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { msg, translate } from "@toonflow/i18n/vue";
import { IconArrowsMove, IconBrightnessHalf, IconGauge, IconMask, IconMusic, IconSparkles } from "@tabler/icons-vue";
import type { VideoDoc } from "../types";
import type { History } from "../useHistory";
import clipFields from "./clipFields.vue";
import effectFields from "./effectFields.vue";
import textFields from "./textFields.vue";
import multiFields from "./multiFields.vue";
import projectFields from "./projectFields.vue";

/**
 * 属性面板：选中片段或文字的全部属性。片段按分组显示，左侧导航切换（OpenCut 的属性面板）；未选中时显示工程设置。
 */
const props = defineProps<{ history: History<VideoDoc>; selection: string[]; time: number }>();
const emit = defineEmits<{ seek: [time: number]; detachAudio: [id: string]; freeze: [id: string] }>();
const allGroups = [
  { id: "transform", label: msg`变换`, icon: IconArrowsMove },
  { id: "audio", label: msg`音频`, icon: IconMusic },
  { id: "speed", label: msg`时长与速度`, icon: IconGauge },
  { id: "blend", label: msg`不透明度与混合`, icon: IconBrightnessHalf },
  { id: "masks", label: msg`蒙版`, icon: IconMask },
  { id: "effects", label: msg`效果`, icon: IconSparkles },
];
const doc = computed(() => props.history.content.value);
const clips = computed(() => doc.value.clips.filter(clip => props.selection.includes(clip.id)));
const texts = computed(() => doc.value.texts.filter(text => props.selection.includes(text.id)));
const picked = ref(localStorage.getItem("toonflow:videoInspectorGroup") || "transform");
watch(picked, value => localStorage.setItem("toonflow:videoInspectorGroup", value));
// 只提供该片段拥有的分组：声音没有画面分组，图片没有音频分组。
const groups = computed(() => {
  const clip = props.selection.length === 1 ? clips.value[0] : undefined;
  if (!clip || clip.kind === "effect") return [];
  const visual = doc.value.tracks.find(track => track.id === clip.track)?.kind === "video";
  return allGroups.filter(group => (group.id === "audio" ? clip.kind !== "image" : group.id === "speed" ? true : visual));
});
const activeGroup = computed(() => (groups.value.some(group => group.id === picked.value) ? picked.value : groups.value[0]?.id ?? null));
provide("inspectorGroup", activeGroup);
</script>

<style lang="scss">
.videoInspector {
  display: flex;
  height: 100%;
  min-height: 0;

  .inspectorRail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 4px;
    border-right: 1px solid var(--el-border-color-lighter);

    button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 6px;
      background: none;
      color: var(--el-text-color-secondary);
      cursor: pointer;

      &:hover { background: var(--el-fill-color-light); }
      &.active { background: color-mix(in srgb, var(--el-color-primary) 14%, transparent); color: var(--el-color-primary); }
    }
  }

  .inspectorBody { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
  .inspectorHead { padding: 10px 12px; border-bottom: 1px solid var(--el-border-color-lighter); font-size: 13px; font-weight: 600; }
  .inspectorScroll { flex: 1; min-height: 0; overflow: auto; }
  .inspectorTop { padding: 10px 12px; border-bottom: 1px solid var(--el-border-color-lighter); }
  .itemName { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .itemMeta { color: var(--el-text-color-secondary); font-size: 11px; }
  .fieldHint { margin: 2px 0; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.5; }
  .fieldHint.padded { padding: 8px 12px; }
  .el-button + .el-button { margin-left: 0; }

  .toggleRow {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;

    .toggleButton {
      min-width: 28px;
      height: 26px;
      padding: 0 6px;
      border: 1px solid var(--el-border-color);
      border-radius: 4px;
      background: var(--el-bg-color);
      color: var(--el-text-color-regular);
      cursor: pointer;

      &.on { border-color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 12%, transparent); color: var(--el-color-primary); }
      &.wide { flex: 1; font-size: 12px; }
    }
  }
}
</style>
