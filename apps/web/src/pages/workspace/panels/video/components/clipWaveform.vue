<template>
  <svg v-if="shape" class="clipWave" :viewBox="`0 0 ${shape.bars} 100`" preserveAspectRatio="none" aria-hidden="true">
    <path :d="shape.path" />
  </svg>
</template>

<script setup lang="ts">
import { computed, inject, shallowRef, watch } from "vue";
import type { VideoClip } from "../types";
import type { Media } from "../media";

/** 声音片段裁剪部分的响度，以填充形状拉伸到片段宽度（音量调高时更高）。 */
const props = defineProps<{ clip: VideoClip }>();
const media = inject<Media>("videoMedia")!;
const data = shallowRef<{ rate: number; peaks: Uint8Array } | null>(null);

watch(() => props.clip.src, src => {
  data.value = null;
  void media.peaksOf(src).then(value => { if (props.clip.src === src) data.value = value; });
}, { immediate: true });

const shape = computed(() => {
  const value = data.value;
  if (!value) return null;
  const gain = Math.min(2, props.clip.muted ? 0 : props.clip.volume ?? 1);
  const start = Math.max(0, Math.floor(props.clip.in * value.rate));
  const end = Math.min(value.peaks.length, Math.ceil(props.clip.out * value.rate));
  const count = end - start;
  if (count <= 0) return null;
  const bars = Math.min(count, 1200);
  const per = count / bars;
  const tops: string[] = [];
  const bottoms: string[] = [];
  for (let index = 0; index < bars; index++) {
    let peak = 0;
    const from = Math.floor(start + index * per);
    for (let sample = from; sample < Math.max(Math.floor(start + (index + 1) * per), from + 1); sample++) peak = Math.max(peak, value.peaks[sample] ?? 0);
    const height = Math.min(50, (peak / 255) * 50 * gain);
    tops.push(`${index} ${(50 - height).toFixed(1)}`);
    bottoms.push(`${index} ${(50 + height).toFixed(1)}`);
  }
  return { bars, path: `M0 50L${tops.join("L")}L${bars} 50L${bottoms.reverse().join("L")}Z` };
});
</script>
