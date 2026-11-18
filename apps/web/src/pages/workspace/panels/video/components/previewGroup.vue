<template>
  <div class="previewGroup" :style="{ zIndex: index }">
    <div class="groupInner" :style="innerStyle">
      <previewGroup v-if="index > 0" :index="index - 1" :tracks="tracks" :layers="layers" :doc="doc" :places="places" :time="time" :k="k" :playing="playing" :rate="rate" :transitionFx="transitionFx" />
      <template v-if="track.magnetic">
        <previewLayer v-for="clip in own" :key="clip.id" :doc="doc" :clip="clip" :place="places.get(clip.id)!" :z="index" :k="k" :time="time" :playing="playing" :rate="rate" :trackMuted="!!track.muted" />
      </template>
    </div>
    <svg v-if="look?.filters.length" class="fxDefinitions" aria-hidden="true">
      <defs>
        <filter v-for="filter in look.filters" :id="filter.id" :key="filter.id" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
          <feGaussianBlur v-if="filter.kind === 'dirBlur'" :stdDeviation="`${filter.sx} ${filter.sy}`" edgeMode="duplicate" />
          <template v-else>
            <feColorMatrix in="SourceGraphic" type="matrix" :values="channel(1, 0, 0)" result="r" />
            <feOffset in="r" :dx="filter.dx" result="r2" />
            <feColorMatrix in="SourceGraphic" type="matrix" :values="channel(0, 1, 0)" result="g" />
            <feColorMatrix in="SourceGraphic" type="matrix" :values="channel(0, 0, 1)" result="b" />
            <feOffset in="b" :dx="-filter.dx" result="b2" />
            <feComposite in="r2" in2="g" operator="arithmetic" :k2="1" :k3="1" result="rg" />
            <feComposite in="rg" in2="b2" operator="arithmetic" :k2="1" :k3="1" />
          </template>
        </filter>
      </defs>
    </svg>
    <previewOverlay v-for="overlay in look?.overlays ?? []" :key="overlay.key" :doc="doc" :overlay="overlay" />
    <template v-if="!track.magnetic">
      <previewLayer v-for="clip in own" :key="clip.id" :doc="doc" :clip="clip" :place="places.get(clip.id)!" :z="index" :k="k" :time="time" :playing="playing" :rate="rate" :trackMuted="!!track.muted" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import type { VideoClip, VideoDoc, VideoTrack } from "../types";
import { effectLook } from "../effects";
import type { Place } from "../videoModel";
import previewLayer from "./previewLayer.vue";
import previewOverlay from "./previewOverlay.vue";

/**
 * 第 `index` 条视频轨（从后到前）及其下方所有内容：每条轨固定一层嵌套，添加特效时不会重新加载视频。内层容器包含下方轨道并承受本轨特效，
 * 其后是特效叠加层，最后是本轨片段，与导出顺序一致。磁性轨相反：内层还包含自身片段，承受片段间转场的特效。
 */
const props = defineProps<{
  index: number; tracks: VideoTrack[]; layers: { clip: VideoClip; z: number }[]; doc: VideoDoc; places: Map<string, Place>;
  time: number; k: number; playing: boolean; rate: number; transitionFx: { c: VideoClip; p: Place }[];
}>();
const track = computed(() => props.tracks[props.index]!);
const own = computed(() => props.layers.filter(layer => layer.z === props.index).map(layer => layer.clip));
const look = computed(() => {
  const { doc, places, time } = props;
  if (track.value.hidden) return null;
  const running = track.value.magnetic
    ? props.transitionFx.filter(({ p }) => time >= p.start && time < p.end)
    : doc.clips.filter(clip => clip.track === track.value.id && clip.kind === "effect" && clip.effect && !clip.hidden).map(clip => ({ c: clip, p: places.get(clip.id)! })).filter(({ p }) => time >= p.start && time < p.end);
  return running.length ? effectLook(doc, running, time, props.k) : null;
});
const innerStyle = computed<CSSProperties | undefined>(() => (look.value ? { filter: look.value.filter || undefined, transform: look.value.transform || undefined } : undefined));
const channel = (r: number, g: number, b: number) => `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`;
</script>
