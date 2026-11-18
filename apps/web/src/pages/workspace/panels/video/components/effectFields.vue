<template>
  <div class="inspectorHead">特效 · {{ track.name }}</div>
  <div class="inspectorScroll">
    <div class="inspectorTop">
      <div class="itemName">✨ {{ clip.name }}</div>
      <div class="itemMeta">{{ timecode(place.start, doc.fps) }} – {{ timecode(place.end, doc.fps) }} · 改变 {{ track.name }} 之下所有轨道的画面</div>
    </div>
    <inspectorSection title="特效">
      <fieldRow label="类型" kind="pick" :value="effect.kind" :options="kindOptions" @change="changeKind" />
      <fieldRow v-if="effect.kind !== 'adjust'" label="强度" kind="range" :value="effect.amount" :min="0" :max="1" :step="0.01" :history="history" :format="percent" @live="value => setEffect({ amount: value }, true)" />
      <fieldRow v-if="effect.kind === 'flash' || effect.kind === 'lightLeak'" label="颜色" kind="color" :value="effect.color ?? '#ffffff'" :history="history" @live="value => setEffect({ color: value }, true)" />
      <fieldRow v-if="effect.kind === 'dirBlur'" label="方向" kind="pick" :value="effect.direction ?? 'horizontal'" :options="directionOptions" @change="value => setEffect({ direction: value as 'horizontal' | 'vertical' })" />
      <p v-if="effectHints[effect.kind]" class="fieldHint">{{ translate(effectHints[effect.kind]!) }}</p>
    </inspectorSection>
    <inspectorSection title="时间">
      <fieldRow label="时长" kind="number" suffix="s" :value="clipLength(clip)" :min="minSeconds" @change="value => set({ in: 0, out: value })" />
      <fieldRow label="开始于" kind="number" suffix="s" :value="clip.start ?? 0" :min="0" @change="value => set({ start: value })" />
    </inspectorSection>
    <inspectorSection title="调色与模糊" :open="effect.kind === 'adjust' || lookOf(clip) !== 'none' || !!clip.blur" resettable
      @reset="set({ brightness: undefined, contrast: undefined, saturation: undefined, hue: undefined, sepia: undefined, grayscale: undefined, blur: undefined })">
      <colorFields :clip="clip" :history="history" />
    </inspectorSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { VideoClip, VideoDoc, VideoEffect, VideoEffectKind } from "../types";
import type { History } from "../useHistory";
import { effectHints, effectLabels } from "../labels";
import { lookOf } from "../presets";
import { cleanEffect, clipLength, effectKinds, effectNames, minSeconds, patchClips, placeAll, timecode } from "../timeline";
import fieldRow from "./fieldRow.vue";
import inspectorSection from "./inspectorSection.vue";
import colorFields from "./colorFields.vue";

// 特效片段：时间、类型、强度及其调色（调整图层的滑块）。
const props = defineProps<{ clip: VideoClip; history: History<VideoDoc> }>();
const doc = computed(() => props.history.content.value);
const track = computed(() => doc.value.tracks.find(item => item.id === props.clip.track)!);
const place = computed(() => placeAll(doc.value).get(props.clip.id)!);
const effect = computed(() => props.clip.effect!);
const kindOptions = computed(() => effectKinds.map(kind => ({ value: kind as string, label: translate(effectLabels[kind]) })));
const directionOptions = computed(() => [{ value: "horizontal", label: translate("水平") }, { value: "vertical", label: translate("垂直") }]);
const percent = (value: number) => `${Math.round(value * 100)}%`;
const set = (patch: Partial<VideoClip>) => props.history.set(patchClips(props.history.content.value, [props.clip.id], patch));
const live = (patch: Partial<VideoClip>) => props.history.live(patchClips(props.history.content.value, [props.clip.id], patch));

function setEffect(patch: Partial<VideoEffect>, now = false) {
  const fresh = props.history.content.value.clips.find(item => item.id === props.clip.id)?.effect ?? effect.value;
  (now ? live : set)({ effect: cleanEffect({ ...fresh, ...patch })! });
}

function changeKind(value: string) {
  const kind = value as VideoEffectKind;
  set({ effect: cleanEffect({ kind })!, name: props.clip.name === effectNames[effect.value.kind] ? effectNames[kind] : props.clip.name });
}
</script>
