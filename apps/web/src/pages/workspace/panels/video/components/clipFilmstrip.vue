<template>
  <div v-if="clip.kind === 'image'" class="clipFilm" :style="thumb ? { backgroundImage: `url(&quot;${thumb}&quot;)` } : undefined" />
  <div v-else-if="strip && height >= 8" class="clipFilm">
    <div v-for="tile in tiles" :key="tile.index" class="filmTile" :style="tile.style" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, shallowRef, watch, type CSSProperties, type ShallowRef } from "vue";
import type { VideoClip, VideoStrip } from "../types";
import type { Media } from "../media";

/**
 * 视频片段上的胶片条：每个图块取所在位置中点最近的帧，只绘制滚动可见范围内的图块。图片显示缩略图。
 * 片段第一次接近可见范围时才生成，片段多时不会一打开就为每个文件运行 FFmpeg。
 */
const props = defineProps<{ clip: VideoClip; left: number; width: number; height: number; pps: number }>();
const media = inject<Media>("videoMedia")!;
const view = inject<ShallowRef<{ left: number; width: number }>>("timelineView")!;
const strip = shallowRef<VideoStrip | null>(null);
const thumb = shallowRef<string | null>(null);
/** 在可见范围或左右一屏之内。 */
const nearView = computed(() => props.left + props.width >= view.value.left - view.value.width && props.left <= view.value.left + 2 * view.value.width);
/** 已请求的文件，接近可见范围后保持，离开时不清除。 */
const wanted = shallowRef<string | null>(null);
watch([() => props.clip.src, nearView], ([src, near]) => { if (near) wanted.value = src; else if (wanted.value !== src) wanted.value = null; }, { immediate: true });

watch(() => [wanted.value, props.clip.kind] as const, ([src, kind]) => {
  strip.value = null;
  thumb.value = null;
  if (!src) return;
  if (kind === "image") void media.thumbOf(src).then(url => { if (wanted.value === src) thumb.value = url; });
  else void media.stripOf(src).then(value => { if (wanted.value === src) strip.value = value; });
}, { immediate: true });

const tiles = computed(() => {
  const value = strip.value;
  if (!value) return [];
  const tileWidth = Math.max(8, (value.width * props.height) / value.height);
  const speed = props.clip.speed ?? 1;
  const { left, width } = view.value;
  const from = Math.max(0, Math.floor((left - props.left) / tileWidth) - 1);
  const to = Math.min(Math.ceil(props.width / tileWidth), Math.ceil((left + width - props.left) / tileWidth) + 1);
  const result: { index: number; style: CSSProperties }[] = [];
  for (let index = from; index < to; index++) {
    const at = props.clip.in + ((index + 0.5) * tileWidth * speed) / props.pps;
    const frame = Math.min(value.count - 1, Math.max(0, Math.floor((at / value.duration) * value.count)));
    result.push({
      index,
      style: { left: `${index * tileWidth}px`, width: `${tileWidth}px`, backgroundImage: `url(${value.image})`, backgroundSize: `${value.count * tileWidth}px 100%`, backgroundPosition: `${-frame * tileWidth}px 0` },
    });
  }
  return result;
});
</script>
