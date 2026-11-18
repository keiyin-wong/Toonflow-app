<template>
  <div ref="boxElement" class="videoPreview" :class="{ zoomed }">
    <div ref="stageElement" class="previewStage" :style="{ width: `${stage.w}px`, height: `${stage.h}px`, background: doc.background }" @pointerdown="selectAt">
      <previewGroup v-if="videoTracks.length" :index="videoTracks.length - 1" :tracks="videoTracks" :layers="layers" :doc="doc" :places="places" :time="time" :k="k" :playing="forward" :rate="rate" :transitionFx="transitionFx" />
      <canvas ref="textCanvas" class="stageFill textLayer" />
      <div v-if="guides" class="guideLayer">
        <template v-if="guides === 'safe'">
          <div class="safeArea action" title="动作安全区（90%）" />
          <div class="safeArea title" title="字幕安全区（80%）" />
        </template>
        <template v-if="guides === 'safe' || guides === 'grid'">
          <div class="third vertical1" />
          <div class="third vertical2" />
          <div class="third horizontal1" />
          <div class="third horizontal2" />
        </template>
        <template v-if="zone">
          <div class="platformZone" :style="{ left: 0, right: 0, top: 0, height: `${zone.top * 100}%` }">顶部栏</div>
          <div class="platformZone" :style="{ left: 0, right: 0, bottom: 0, height: `${zone.bottom * 100}%` }">昵称与文案</div>
          <div class="platformZone side" :style="{ left: 0, top: `${zone.top * 100}%`, bottom: `${zone.bottom * 100}%`, width: `${zone.left * 100}%` }" />
          <div class="platformZone side" :style="{ right: 0, top: `${zone.top * 100}%`, bottom: `${zone.bottom * 100}%`, width: `${zone.right * 100}%` }">按钮</div>
          <div class="safeArea zone" :style="{ top: `${zone.top * 100}%`, bottom: `${zone.bottom * 100}%`, left: `${zone.left * 100}%`, right: `${zone.right * 100}%` }" />
        </template>
      </div>
      <div v-if="clipOutline" class="selectionOutline" :style="clipOutline" @pointerdown="startDrag($event, 'move')">
        <span v-for="corner in corners" :key="corner" class="outlineHandle" :class="corner" @pointerdown="startDrag($event, 'scale')" />
      </div>
      <div v-if="textOutline" class="selectionOutline text" :style="textOutline" @pointerdown="startDrag($event, 'move')" />
      <div v-if="!doc.clips.length && !doc.texts.length" class="stageEmpty">
        <b>时间线上还没有内容</b>
        <span>从左侧素材面板把视频、图片或音乐拖到下方轨道，或从画布挑选素材。</span>
      </div>
    </div>
    <previewSound v-for="sound in sounds" :key="sound.clip.id" :clip="sound.clip" :place="places.get(sound.clip.id)!" :time="time" :playing="forward" :rate="rate" :muted="sound.muted" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch, watchEffect, type CSSProperties, type ShallowRef } from "vue";
import type { VideoDoc, VideoText } from "../types";
import type { History } from "../useHistory";
import { drawText, measureText } from "../captions";
import { platformZones, type GuideMode } from "../guides";
import { useWheelZoom } from "../viewZoom";
import {
  boxSize, centreAt, docLength, hasContent, isKeyed, patchClips, patchTexts, placeAll, propAt, setProps, textAlphaAt, textOffsetAt, textTracksBackToFront,
  textWipeBlur, textWipeSoft, textWipeAt, transitionEffects, videoTracksBackToFront, type Place,
} from "../timeline";
import previewGroup from "./previewGroup.vue";
import previewSound from "./previewSound.vue";

const props = withDefaults(defineProps<{
  history: History<VideoDoc>;
  playing: boolean;
  /** J / K / L：2 为两倍速，-1 为倒放。 */
  rate: number;
  guides: GuideMode | null;
  /** 每画面像素对应的舞台像素；null 为适应窗口。 */
  zoom?: number | null;
  selection: string[];
}>(), { zoom: null });
const emit = defineEmits<{ select: [ids: string[]]; time: [time: number]; ended: []; scale: [scale: number]; zoom: [zoom: number] }>();

/** 片段开始前提前创建元素的秒数，保证播放到时已加载。 */
const preload = 1.5;
const corners = ["nw", "ne", "sw", "se"] as const;
const doc = computed(() => props.history.content.value);
/** 播放头：由页面提供，播放时每帧更新，只有跟随画面的组件读取。 */
const clock = inject<ShallowRef<number>>("videoClock")!;
const time = computed(() => clock.value);
const boxElement = ref<HTMLElement>();
const stageElement = ref<HTMLElement>();
const textCanvas = ref<HTMLCanvasElement>();
const area = ref({ w: 0, h: 0 });
const elements = new Map<string, HTMLMediaElement>();
provide("previewElements", elements);

const fitScale = computed(() => Math.max(0, Math.min((area.value.w - 24) / doc.value.width, (area.value.h - 24) / doc.value.height)));
const scale = computed(() => props.zoom ?? fitScale.value);
const stage = computed(() => ({ w: Math.max(0, Math.floor(doc.value.width * scale.value)), h: Math.max(0, Math.floor(doc.value.height * scale.value)) }));
const zoomed = computed(() => props.zoom !== null && (stage.value.w > area.value.w - 24 || stage.value.h > area.value.h - 24));
// 媒体元素只能正向播放：倒放时保持暂停，逐帧跳转。
const forward = computed(() => props.playing && props.rate > 0);
const k = computed(() => stage.value.w / doc.value.width);
const places = computed(() => placeAll(doc.value));
const videoTracks = computed(() => videoTracksBackToFront(doc.value));
const near = (id: string) => {
  const place = places.value.get(id)!;
  return time.value >= place.start - preload && time.value < place.end;
};
const layers = computed(() => videoTracks.value.flatMap((track, z) => (track.hidden ? [] : doc.value.clips.filter(clip => clip.track === track.id && clip.kind !== "effect" && !clip.hidden && near(clip.id)).map(clip => ({ clip, z })))));
// 隐藏轨道或隐藏片段不绘制画面，但声音照常播放（与导出一致）。
const sounds = computed(() => [
  ...doc.value.tracks.filter(track => track.kind === "audio").flatMap(track => doc.value.clips.filter(clip => clip.track === track.id && near(clip.id)).map(clip => ({ clip, muted: !!track.muted }))),
  ...doc.value.tracks.filter(track => track.kind === "video").flatMap(track => doc.value.clips.filter(clip => clip.track === track.id && clip.kind === "video" && (track.hidden || clip.hidden) && near(clip.id)).map(clip => ({ clip, muted: !!track.muted }))),
]);
const transitionFx = computed(() => transitionEffects(doc.value, places.value));
const zone = computed(() => (props.guides === "tiktok" || props.guides === "reels" || props.guides === "shorts" ? platformZones[props.guides] : null));

let observer: ResizeObserver | undefined;
onMounted(() => {
  const element = boxElement.value!;
  const measure = () => { area.value = { w: element.clientWidth, h: element.clientHeight }; };
  measure();
  observer = new ResizeObserver(measure);
  observer.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());
watch(scale, value => emit("scale", value), { immediate: true });
// 新的缩放显示画面中部。
watch(() => props.zoom, () => requestAnimationFrame(() => {
  const element = boxElement.value;
  if (!element) return;
  element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
  element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
}));
useWheelZoom(boxElement, () => scale.value, value => emit("zoom", value));

/** 模糊擦除中的文字：先单独绘制，再把模糊副本限制在边缘前的带状区域、清晰副本限制在边缘已经过的区域。 */
function drawWiped(context: CanvasRenderingContext2D, text: VideoText, value: VideoDoc, progress: number) {
  const make = () => Object.assign(document.createElement("canvas"), { width: value.width, height: value.height });
  const words = make();
  const box = drawText(words.getContext("2d")!, text, value.width, value.height);
  const soft = textWipeSoft;
  const edge = progress * (1 + 2 * soft);
  const at = (u: number) => box.x + u * box.w;
  const layer = (blur: boolean) => {
    const canvas = make();
    const layerContext = canvas.getContext("2d")!;
    if (blur) layerContext.filter = `blur(${textWipeBlur * value.width}px)`;
    layerContext.drawImage(words, 0, 0);
    layerContext.filter = "none";
    const gradient = blur ? layerContext.createLinearGradient(at(edge - 2 * soft), 0, at(edge), 0) : layerContext.createLinearGradient(at(edge - 2 * soft), 0, at(edge - soft), 0);
    gradient.addColorStop(0, blur ? "rgba(0,0,0,0)" : "#000");
    if (blur) gradient.addColorStop(0.5, "#000");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    layerContext.globalCompositeOperation = "destination-in";
    layerContext.fillStyle = gradient;
    layerContext.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  };
  context.drawImage(layer(true), 0, 0);
  context.drawImage(layer(false), 0, 0);
}

// 所有文字画在同一块画布上：按视频尺寸绘制，再缩放到舞台。
watchEffect(() => {
  const canvas = textCanvas.value;
  const context = canvas?.getContext("2d");
  const value = doc.value;
  const now = time.value;
  if (!canvas || !context) return;
  const ratio = devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(stage.value.w * ratio));
  canvas.height = Math.max(1, Math.round(stage.value.h * ratio));
  context.setTransform(canvas.width / value.width, 0, 0, canvas.height / value.height, 0, 0);
  for (const track of textTracksBackToFront(value)) {
    if (track.hidden) continue;
    for (const text of value.texts.filter(item => item.track === track.id)) {
      const alpha = textAlphaAt(text, now);
      if (alpha <= 0 || text.hidden || !hasContent(text)) continue;
      context.globalAlpha = alpha;
      const offset = textOffsetAt(text, now);
      context.save();
      context.translate(offset.dx * value.width, offset.dy * value.height);
      const wipe = textWipeAt(text, now);
      if (wipe === null) drawText(context, text, value.width, value.height);
      else drawWiped(context, text, value, wipe);
      context.restore();
    }
  }
  context.globalAlpha = 1;
}, { flush: "post" });

// 播放时钟：磁性轨视频播放时以其元素为准，图片或空隙处使用系统时钟。
let frame = 0;
watch([() => props.playing, () => props.rate < 0], ([playing]) => {
  cancelAnimationFrame(frame);
  if (!playing) return;
  let last = performance.now();
  const tick = (now: number) => {
    const value = doc.value;
    const placeMap = placeAll(value);
    const start = time.value;
    const rate = props.rate;
    let next = start + ((now - last) / 1000) * rate;
    last = now;
    if (rate < 0) {
      if (next <= 0) {
        emit("time", 0);
        emit("ended");
        return;
      }
      emit("time", next);
      frame = requestAnimationFrame(tick);
      return;
    }
    const magneticId = value.tracks.find(track => track.magnetic)?.id;
    const master = value.clips.find(clip => clip.track === magneticId && clip.kind === "video" && start >= placeMap.get(clip.id)!.start && start < placeMap.get(clip.id)!.end);
    const element = master && (elements.get(master.id) as HTMLVideoElement | undefined);
    if (master && element) {
      const place = placeMap.get(master.id)!;
      if (!element.paused && !element.seeking && element.readyState >= 3) next = place.start + (element.currentTime - master.in) / (master.speed ?? 1);
      else if (!element.ended) next = start;
    }
    const end = docLength(value, placeMap);
    if (next >= end) {
      emit("time", end);
      emit("ended");
      return;
    }
    emit("time", Math.max(next, start));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
});
onBeforeUnmount(() => cancelAnimationFrame(frame));

// ---- 在画面中选择与移动 ----

const pointToFrame = (event: { clientX: number; clientY: number }) => {
  const rect = stageElement.value!.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / k.value, y: (event.clientY - rect.top) / k.value };
};

/** 文字在播放头处绘制的位置（含滑动位移）。 */
const textBox = (text: VideoText) => {
  const box = measureText(text, doc.value.width, doc.value.height);
  const offset = textOffsetAt(text, time.value);
  return { ...box, x: box.x + offset.dx * doc.value.width, y: box.y + offset.dy * doc.value.height };
};

/** 播放头处画面某点下的内容：先文字，再从前到后的片段。 */
function hit(x: number, y: number): string | null {
  const value = doc.value;
  for (const track of textTracksBackToFront(value).reverse()) {
    if (track.hidden) continue;
    for (const text of value.texts.filter(item => item.track === track.id && !item.hidden && textAlphaAt(item, time.value) > 0).reverse()) {
      const box = textBox(text);
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return text.id;
    }
  }
  for (const { clip } of [...layers.value].reverse()) {
    const place = places.value.get(clip.id)!;
    if (time.value < place.start || time.value >= place.end) continue;
    const { w, h } = boxSize(value, clip, propAt(clip, "scale", place, time.value));
    const centre = centreAt(clip, place, time.value);
    if (Math.abs(x - centre.x * value.width) <= w / 2 && Math.abs(y - centre.y * value.height) <= h / 2) return clip.id;
  }
  return null;
}

function selectAt(event: PointerEvent) {
  if (event.button !== 0) return;
  const at = pointToFrame(event);
  const id = hit(at.x, at.y);
  emit("select", id ? [id] : []);
}

const selected = computed(() => (props.selection.length === 1 ? props.selection[0] : null));
const selectedClip = computed(() => (selected.value ? doc.value.clips.find(clip => clip.id === selected.value && clip.kind !== "audio" && clip.kind !== "effect") : undefined));
const selectedText = computed(() => (selected.value ? doc.value.texts.find(text => text.id === selected.value) : undefined));

const clipOutline = computed<CSSProperties | null>(() => {
  const clip = selectedClip.value;
  const place = clip && places.value.get(clip.id);
  if (!clip || !place || time.value < place.start || time.value >= place.end) return null;
  const { w, h } = boxSize(doc.value, clip, propAt(clip, "scale", place, time.value));
  const centre = centreAt(clip, place, time.value);
  const rotation = propAt(clip, "rotation", place, time.value);
  return {
    left: `${(centre.x * doc.value.width - w / 2) * k.value}px`, top: `${(centre.y * doc.value.height - h / 2) * k.value}px`,
    width: `${w * k.value}px`, height: `${h * k.value}px`, transform: rotation ? `rotate(${rotation}deg)` : undefined,
  };
});
const textOutline = computed<CSSProperties | null>(() => {
  const text = selectedText.value;
  if (!text || time.value < text.start || time.value >= text.start + text.duration) return null;
  const box = textBox(text);
  return { left: `${box.x * k.value}px`, top: `${box.y * k.value}px`, width: `${box.w * k.value}px`, height: `${box.h * k.value}px` };
});

function startDrag(event: PointerEvent, how: "move" | "scale") {
  if (event.button !== 0) return;
  event.stopPropagation();
  event.preventDefault();
  const history = props.history;
  const start = pointToFrame(event);
  const original = history.content.value;
  const clip = selectedClip.value && original.clips.find(item => item.id === selectedClip.value!.id);
  const text = selectedText.value && original.texts.find(item => item.id === selectedText.value!.id);
  if (!clip && !text) return;
  history.begin();
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const move = (moveEvent: PointerEvent) => {
    const at = pointToFrame(moveEvent);
    const dx = (at.x - start.x) / original.width;
    const dy = (at.y - start.y) / original.height;
    if (text) return history.live(patchTexts(original, [text.id], item => ({ style: { ...item.style, x: text.style.x + dx, y: text.style.y + dy } })));
    if (!clip) return;
    const place: Place = placeAll(original).get(clip.id)!;
    const now = time.value;
    if (how === "move" && (isKeyed(clip, "x") || isKeyed(clip, "y"))) {
      // 位置有动画：在播放头处写关键帧。
      const centre = centreAt(clip, place, now);
      return history.live(patchClips(original, [clip.id], setProps(clip, place, now, { x: round(centre.x + dx), y: round(centre.y + dy) })));
    }
    if (how === "move") {
      const shift = (value: { x: number; y: number }) => ({ x: round(value.x + dx), y: round(value.y + dy) });
      return history.live(patchClips(original, [clip.id], { ...shift({ x: clip.x ?? 0.5, y: clip.y ?? 0.5 }), ...(clip.moveTo && { moveTo: shift(clip.moveTo) }) }));
    }
    // 按角点到中心的距离相对起点的比例缩放。
    const centre = centreAt(clip, place, now);
    const cx = centre.x * original.width;
    const cy = centre.y * original.height;
    const ratio = Math.hypot(at.x - cx, at.y - cy) / Math.max(1, Math.hypot(start.x - cx, start.y - cy));
    history.live(patchClips(original, [clip.id], setProps(clip, place, now, { scale: Math.max(0.05, round(propAt(clip, "scale", place, now) * ratio)) })));
  };
  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    history.end();
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}
</script>

<style lang="scss">
.videoPreview {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #111;

  &.zoomed { display: block; overflow: auto; }

  .previewStage {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    margin: auto;
    box-shadow: 0 0 0 1px #ffffff1a;
    user-select: none;
  }

  .stageFill { position: absolute; inset: 0; width: 100%; height: 100%; }
  .textLayer { pointer-events: none; z-index: 900; }

  .previewGroup, .groupInner { position: absolute; inset: 0; }
  .previewLayer { position: absolute; inset: 0; pointer-events: none; }
  .blurBack { overflow: hidden; }
  .coverMedia { width: 100%; height: 100%; object-fit: cover; filter: blur(24px) brightness(0.75); transform: scale(1.1); }
  .mediaBox { position: absolute; overflow: hidden; }
  .boxMedia { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; }
  .borderBox { position: absolute; }
  .dipLayer { position: absolute; inset: 0; }
  .fxOverlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .fxOverlay.grain { mix-blend-mode: overlay; image-rendering: pixelated; }
  .fxOverlay.leak { mix-blend-mode: screen; }
  .fxDefinitions { position: absolute; width: 0; height: 0; }

  .guideLayer {
    position: absolute;
    inset: 0;
    z-index: 950;
    pointer-events: none;

    .safeArea { position: absolute; border: 1px dashed #ffffff8c; }
    .safeArea.action { inset: 5%; }
    .safeArea.title { inset: 10%; }
    .third { position: absolute; background: #ffffff4d; }
    .third.vertical1, .third.vertical2 { top: 0; bottom: 0; width: 1px; }
    .third.vertical1 { left: 33.333%; }
    .third.vertical2 { left: 66.666%; }
    .third.horizontal1, .third.horizontal2 { left: 0; right: 0; height: 1px; }
    .third.horizontal1 { top: 33.333%; }
    .third.horizontal2 { top: 66.666%; }
    .platformZone {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ff3b3b33;
      color: #ffffffcc;
      font-size: 11px;
    }
  }

  .selectionOutline {
    position: absolute;
    z-index: 960;
    border: 1px solid var(--el-color-primary);
    cursor: move;

    &.text { border-style: dashed; }

    .outlineHandle {
      position: absolute;
      width: 9px;
      height: 9px;
      border: 1px solid var(--el-color-primary);
      background: #fff;

      &.nw { left: -5px; top: -5px; cursor: nwse-resize; }
      &.ne { right: -5px; top: -5px; cursor: nesw-resize; }
      &.sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
      &.se { right: -5px; bottom: -5px; cursor: nwse-resize; }
    }
  }

  .stageEmpty {
    position: absolute;
    inset: 0;
    z-index: 970;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    color: #ffffffb3;
    font-size: 13px;
    text-align: center;
    pointer-events: none;
  }
}
</style>
