<template>
  <div class="inspectorHead">已选择 {{ clips.length + texts.length }} 项</div>
  <div class="inspectorScroll">
    <p class="fieldHint padded">Delete 删除全部；S 切开播放头经过的每一项；拖动其中一项即可一起移动。</p>
    <inspectorSection v-if="visual.length" :title="t`${visual.length} 个画面片段`">
      <fieldRow label="填充画面" kind="pick" :value="commonFit" :options="fitOptions" @change="value => history.set(patchClips(doc, ids, { fit: value === 'fit' ? undefined : value as VideoClip['fit'] }))" />
      <fieldRow label="混合模式" kind="pick" value="—" :options="blendOptions" @change="value => value !== '—' && history.set(patchClips(doc, ids, { blend: value === 'normal' ? undefined : value as VideoBlend }))" />
      <div class="toggleRow">
        <button class="toggleButton wide" @click="history.set(patchClips(doc, ids, { hidden: true }))">隐藏</button>
        <button class="toggleButton wide" @click="history.set(patchClips(doc, ids, { hidden: undefined }))">显示</button>
      </div>
      <fieldRow label="Ken Burns" kind="pick" value="—" :options="kenBurnsOptions" @change="value => value !== '—' && history.set(patchClips(doc, ids, { kenBurns: kenBurnsPresets[value] ?? undefined }))" />
      <fieldRow label="转场" kind="pick" value="—" :options="transitionOptions" @change="applyTransition" />
    </inspectorSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t, translate } from "@toonflow/i18n/vue";
import type { VideoBlend, VideoClip, VideoDoc, VideoText, VideoTransitionKind } from "../types";
import type { History } from "../useHistory";
import { blendLabels, fitLabels, kenBurnsLabels, transitionLabels } from "../labels";
import { blends, patchClips, transitionDirected, transitionKinds, transitionSeconds } from "../timeline";
import fieldRow from "./fieldRow.vue";
import inspectorSection from "./inspectorSection.vue";

// 多选：批量设置填充、混合、显隐、Ken Burns 与转场。
const props = defineProps<{ history: History<VideoDoc>; clips: VideoClip[]; texts: VideoText[] }>();
const doc = computed(() => props.history.content.value);
const visual = computed(() => props.clips.filter(clip => clip.kind !== "effect" && doc.value.tracks.find(track => track.id === clip.track)?.kind === "video"));
const ids = computed(() => visual.value.map(clip => clip.id));
const commonFit = computed(() => (visual.value.every(clip => clip.fit === visual.value[0]?.fit) ? visual.value[0]?.fit ?? "fit" : "fit"));
const fitOptions = computed(() => (["fit", "fill", "blur"] as const).map(fit => ({ value: fit as string, label: translate(fitLabels[fit]) })));
const blendOptions = computed(() => [{ value: "—", label: "—" }, ...blends.map(blend => ({ value: blend as string, label: translate(blendLabels[blend]) }))]);
const kenBurnsPresets: Record<string, VideoClip["kenBurns"] | null> = {
  none: null,
  zoomIn: { from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.3, x: 0.5, y: 0.5 } },
  zoomOut: { from: { zoom: 1.3, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } },
  panLeft: { from: { zoom: 1.25, x: 0.7, y: 0.5 }, to: { zoom: 1.25, x: 0.3, y: 0.5 } },
  panRight: { from: { zoom: 1.25, x: 0.3, y: 0.5 }, to: { zoom: 1.25, x: 0.7, y: 0.5 } },
  panUp: { from: { zoom: 1.25, x: 0.5, y: 0.7 }, to: { zoom: 1.25, x: 0.5, y: 0.3 } },
  panDown: { from: { zoom: 1.25, x: 0.5, y: 0.3 }, to: { zoom: 1.25, x: 0.5, y: 0.7 } },
};
const kenBurnsOptions = computed(() => [{ value: "—", label: "—" }, ...Object.keys(kenBurnsPresets).map(name => ({ value: name, label: translate(kenBurnsLabels[name]!) }))]);
const transitionOptions = computed(() => [{ value: "—", label: "—" }, { value: "cut", label: translate("硬切") }, ...transitionKinds.map(kind => ({ value: kind as string, label: translate(transitionLabels[kind]) }))]);

function applyTransition(value: string) {
  if (value === "—") return;
  const kind = value as VideoTransitionKind | "cut";
  props.history.set(patchClips(doc.value, ids.value, clip => ({
    transition: kind === "cut" ? undefined : { kind, duration: clip.transition?.duration ?? transitionSeconds[kind], ...(transitionDirected.includes(kind) && { direction: clip.transition?.direction ?? "left" }) },
  })));
}
</script>
