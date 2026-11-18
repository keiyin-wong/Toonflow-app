<template>
  <audio ref="audioElement" :src="src" preload="auto" />
</template>

<script setup lang="ts">
import { inject, ref, watch, watchEffect } from "vue";
import type { VideoClip } from "../types";
import { syncElement, type Media } from "../media";
import { gainAt, type Place } from "../videoModel";

// 音频轨片段（或隐藏视频轨的声音）：保持同步的 <audio>，音量取自 gainAt。
const props = defineProps<{ clip: VideoClip; place: Place; time: number; playing: boolean; rate: number; muted: boolean }>();
const media = inject<Media>("videoMedia")!;
const audioElement = ref<HTMLAudioElement>();
const src = ref("");

watch(() => props.clip.src, path => {
  src.value = "";
  void media.url(path).then(url => { if (props.clip.src === path) src.value = url; }, () => {});
}, { immediate: true });

watchEffect(() => {
  const { clip, place, time, playing, rate, muted } = props;
  if (audioElement.value) syncElement(audioElement.value, clip, place, time, playing, 30, gainAt(clip, place, time, muted), rate);
}, { flush: "post" });
</script>
