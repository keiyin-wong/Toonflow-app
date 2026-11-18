<template>{{ format(clock) }}</template>

<script setup lang="ts">
import { inject, type ShallowRef } from "vue";

// 随播放头每帧更新的时间文字，不让外层组件跟着重新渲染。
defineProps<{ format: (time: number) => string }>();
const clock = inject<ShallowRef<number>>("videoClock")!;
</script>
