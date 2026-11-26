<template>
  <div class="previewLayer" :style="look.layer">
    <div v-if="clip.fit === 'blur'" class="stageFill blurBack" :style="look.back">
      <video v-if="isVideo" ref="backElement" class="coverMedia" :src="src" preload="auto" playsinline muted />
      <img v-else-if="src" class="coverMedia" :src="src" alt="" draggable="false" />
      <div v-if="look.dip" class="dipLayer" :style="look.dip" />
    </div>
    <div v-if="look.border" class="borderBox" :style="look.border" />
    <div class="mediaBox" :style="look.box">
      <video v-if="isVideo" ref="mainElement" class="boxMedia" :style="look.media" :src="src" preload="auto" playsinline />
      <img v-else-if="src" class="boxMedia" :style="look.media" :src="src" alt="" draggable="false" />
      <div v-if="look.dip" class="dipLayer" :style="look.dip" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, watchEffect, type CSSProperties } from "vue";
import type { VideoClip, VideoDoc } from "../types";
import type { Media } from "../media";
import { syncElement } from "../media";
import { cssFilters, revealMask } from "../effects";
import { maskUrl } from "../masks";
import { borderPx, boxSize, centreAt, gainAt, isKeyed, kenBurnsAt, maxScale, propAt, revealAt, transitionShift, visibilityAt, type Place } from "../videoModel";

const props = defineProps<{ doc: VideoDoc; clip: VideoClip; place: Place; z: number; k: number; time: number; playing: boolean; rate: number; trackMuted: boolean }>();
const media = inject<Media>("videoMedia")!;
const elements = inject<Map<string, HTMLMediaElement>>("previewElements")!;
const mainElement = ref<HTMLVideoElement>();
const backElement = ref<HTMLVideoElement>();
const src = ref("");
const isVideo = computed(() => props.clip.kind === "video");

let held: ReturnType<Media["acquire"]> | undefined;
watch(() => props.clip.src, path => {
  src.value = "";
  held?.release();
  const current = held = media.acquire(path);
  void current.url.then(url => { if (held === current) src.value = url; }, () => {});
}, { immediate: true });

onMounted(() => { if (mainElement.value) elements.set(props.clip.id, mainElement.value); });
onBeforeUnmount(() => {
  elements.delete(props.clip.id);
  held?.release();
  held = undefined;
});

watchEffect(() => {
  const { clip, place, time, playing, doc, rate, trackMuted } = props;
  if (mainElement.value) syncElement(mainElement.value, clip, place, time, playing, doc.fps, gainAt(clip, place, time, trackMuted), rate);
  if (backElement.value) syncElement(backElement.value, clip, place, time, playing, doc.fps, null, rate);
}, { flush: "post" });

const look = computed(() => {
  const { doc, clip, place, time, k, z } = props;
  const visibility = visibilityAt(clip, place, time);
  const active = time >= place.start && time < place.end && visibility.shown;
  const { w, h } = boxSize(doc, clip, propAt(clip, "scale", place, time));
  const shift = transitionShift(place, time);
  const centre = centreAt(clip, place, time);
  const x = centre.x + shift.dx;
  const y = centre.y + shift.dy;
  const reveal = revealAt(place, time);
  const rotation = propAt(clip, "rotation", place, time);
  // 边框按片段最大尺寸计算再随缩放变化，与导出先加边框后缩放一致。
  const top = isKeyed(clip, "scale") ? maxScale(clip) : propAt(clip, "scale", place, time);
  const big = boxSize(doc, clip, top);
  const border = (borderPx(clip, big.w, big.h) * w) / Math.max(1, big.w);
  // 固定不透明度已画进蒙版。
  const opacity = isKeyed(clip, "opacity") ? Math.min(1, Math.max(0, propAt(clip, "opacity", place, time))) : 1;
  const kenBurns = kenBurnsAt(clip, place, time);
  const mask = maskUrl(doc, clip);
  const masks = [mask && `url(${mask})`, reveal && revealMask(reveal, w * k, h * k)].filter(Boolean) as string[];
  const filters = cssFilters(clip);
  const turn = rotation ? `rotate(${rotation}deg)` : undefined;
  const dip: CSSProperties | null = visibility.dip && visibility.dip.amount > 0 ? { background: visibility.dip.color, opacity: visibility.dip.amount } : null;
  const backMask = reveal ? revealMask(reveal, doc.width * k, doc.height * k) : undefined;
  return {
    layer: { zIndex: z, opacity: active ? visibility.alpha * opacity : 0, filter: filters || undefined, mixBlendMode: clip.blend && clip.blend !== "normal" ? clip.blend : undefined } as CSSProperties,
    back: {
      transform: shift.dx || shift.dy ? `translate(${shift.dx * doc.width * k}px, ${shift.dy * doc.height * k}px)` : undefined,
      maskImage: backMask, WebkitMaskImage: backMask,
    } as CSSProperties,
    border: border > 0 ? {
      left: `${(x * doc.width - w / 2 - border) * k}px`, top: `${(y * doc.height - h / 2 - border) * k}px`,
      width: `${(w + 2 * border) * k}px`, height: `${(h + 2 * border) * k}px`, background: clip.border!.color, transform: turn,
    } as CSSProperties : null,
    box: {
      left: `${(x * doc.width - w / 2) * k}px`, top: `${(y * doc.height - h / 2) * k}px`, width: `${w * k}px`, height: `${h * k}px`,
      transform: turn, filter: clip.blur ? `blur(${clip.blur * k}px)` : undefined,
      ...(masks.length && {
        maskImage: masks.join(", "), WebkitMaskImage: masks.join(", "), maskSize: masks.map(() => "100% 100%").join(", "), WebkitMaskSize: masks.map(() => "100% 100%").join(", "),
        ...(masks.length > 1 && { maskComposite: "intersect", WebkitMaskComposite: "source-in" }),
      }),
    } as CSSProperties,
    media: kenBurns ? { width: `${100 / kenBurns.w}%`, height: `${100 / kenBurns.h}%`, left: `${(-kenBurns.x / kenBurns.w) * 100}%`, top: `${(-kenBurns.y / kenBurns.h) * 100}%` } as CSSProperties : undefined,
    dip,
  };
});
</script>
