<template>
  <div v-if="overlay.kind === 'solid'" class="fxOverlay" :style="{ background: overlay.color, opacity: overlay.alpha }" />
  <img v-else-if="overlay.kind === 'vignette'" class="fxOverlay" :src="vignetteUrl(doc, overlay.amount)" alt="" draggable="false" />
  <canvas v-else ref="canvasElement" class="fxOverlay" :class="overlay.kind" />
</template>

<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { VideoDoc } from "../types";
import { drawGrain, drawLeak, vignetteUrl, type FxOverlay } from "../effects";

// 特效叠加在下方画面上的图层：纯色（闪光、闪烁）、暗角、颗粒或漏光。
const props = defineProps<{ doc: VideoDoc; overlay: FxOverlay }>();
const canvasElement = ref<HTMLCanvasElement>();

watchEffect(() => {
  const canvas = canvasElement.value;
  const overlay = props.overlay;
  if (!canvas) return;
  if (overlay.kind === "grain") drawGrain(canvas, props.doc, overlay.amount, overlay.frame);
  if (overlay.kind === "leak") drawLeak(canvas, props.doc, overlay);
}, { flush: "post" });
</script>
