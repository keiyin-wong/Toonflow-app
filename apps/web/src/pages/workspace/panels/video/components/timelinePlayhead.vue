<template>
  <div class="timelinePlayhead" :style="{ left: `${offset + clock * pps}px` }" />
</template>

<script setup lang="ts">
import { inject, type ShallowRef } from "vue";

// 播放头竖线：播放时单独每帧更新，不重新渲染整条时间线。
defineProps<{ offset: number; pps: number }>();
const clock = inject<ShallowRef<number>>("videoClock")!;
</script>
