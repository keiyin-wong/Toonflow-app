<template>
  <div class="sourceMonitor" :class="{ active }" @pointerdown="emit('activate')">
    <div class="monitorHead">
      <span class="monitorTitle">源</span>
      <span v-if="source" class="monitorFile" :title="source.path">{{ source.clip.name }}</span>
      <span class="spacer" />
      <el-select v-if="source && clip?.kind !== 'audio'" class="zoomPick" :modelValue="zoom === null ? 'fit' : String(zoom)" size="small" @change="value => (zoom = value === 'fit' ? null : Number(value))">
        <el-option :label="`${translate('适应')} (${Math.round(scale * 100)}%)`" value="fit" />
        <el-option v-for="step in zoomSteps" :key="step" :label="`${Math.round(step * 100)}%`" :value="String(step)" />
      </el-select>
      <el-select v-if="source && targets.length" class="targetPick" :modelValue="target ?? ''" size="small" title="插入与覆盖放到的轨道" @change="value => emit('target', value)">
        <el-option v-for="track in targets" :key="track.id" :label="`→ ${track.name}`" :value="track.id" />
      </el-select>
      <button class="iconButton" title="关闭源监视器" @click="emit('close')"><icon-x :size="15" /></button>
    </div>
    <div v-if="!source || !clip || !range" class="sourceEmpty">
      <b>源监视器</b>
      <span>在素材面板点击视频、图片或音频（或右键片段 → 在源监视器打开），可在此观看、标记入点（I）与出点（O），再在播放头处插入（,）或覆盖（.），也可把画面拖到轨道上。</span>
    </div>
    <template v-else>
      <div ref="viewElement" class="sourceView" :class="{ zoomed: isZoomed }" title="点击播放 / 暂停 · 拖到轨道上添加标记区间" draggable="true" @dragstart="dragRange" @click="toggle">
        <img v-if="still" :src="src" alt="" draggable="false" :style="size" @load="event => setNatural((event.target as HTMLImageElement).naturalWidth, (event.target as HTMLImageElement).naturalHeight)" />
        <template v-else-if="clip.kind === 'audio'">
          <div class="sourceAudio">♪ {{ clip.name }}</div>
          <audio ref="mediaElement" :src="src" preload="auto" @play="playing = true" @pause="playing = false" @seeked="sync" />
        </template>
        <video v-else ref="mediaElement" :src="src" preload="auto" playsinline :style="size"
          @loadedmetadata="event => setNatural((event.target as HTMLVideoElement).videoWidth, (event.target as HTMLVideoElement).videoHeight)" @play="playing = true" @pause="playing = false" @seeked="sync" />
      </div>
      <div v-if="!still" ref="barElement" class="sourceBar" title="点击或拖动移动 · I 标记入点，O 标记出点" @pointerdown="scrub">
        <div class="sourceRange" :style="{ left: percent(markIn), width: `calc(${percent(markOut)} - ${percent(markIn)})` }" />
        <div v-if="marks.in !== null" class="sourceMark in" :style="{ left: percent(marks.in) }" />
        <div v-if="marks.out !== null" class="sourceMark out" :style="{ left: percent(marks.out) }" />
        <div class="sourceHead" :style="{ left: percent(time) }" />
      </div>
      <div class="monitorControls">
        <template v-if="!still">
          <button class="iconButton" title="跳到入点（Shift+I）" @click="seek(markIn)"><icon-arrow-bar-to-left :size="15" /></button>
          <button class="iconButton" title="后退一帧（←）" @click="seek(time - 1 / fps)"><icon-player-skip-back :size="15" /></button>
          <button class="iconButton play" title="播放 / 暂停（空格）" @click="toggle"><component :is="playing ? IconPlayerPauseFilled : IconPlayerPlayFilled" :size="15" /></button>
          <button class="iconButton" title="前进一帧（→）" @click="seek(time + 1 / fps)"><icon-player-skip-forward :size="15" /></button>
          <button class="iconButton" title="跳到出点（Shift+O）" @click="seek(markOut)"><icon-arrow-bar-to-right :size="15" /></button>
          <button class="markButton" :class="{ on: marks.in !== null }" title="在此标记入点（I）" @click="emit('marks', markAt(marks, 'in', time))">{ 入</button>
          <button class="markButton" :class="{ on: marks.out !== null }" title="在此标记出点（O）" @click="emit('marks', markAt(marks, 'out', time))">出 }</button>
          <button v-if="marks.in !== null || marks.out !== null" class="iconButton" title="清除入点与出点（Alt+X）" @click="emit('marks', { in: null, out: null })"><icon-eraser :size="15" /></button>
          <span class="monitorTime">{{ timecode(time, fps) }} · {{ timecode(clipLength(range), fps) }}</span>
        </template>
        <span v-else class="monitorTime">图片：在时间线上 {{ clipLength(range) }} 秒</span>
        <span class="spacer" />
        <span class="sourceGrip" draggable="true" title="把标记区间拖到轨道上" @dragstart="dragRange"><icon-grip-vertical :size="15" /></span>
        <el-button size="small" :disabled="!target" title="在播放头处插入：其后的内容后移（,）" @click="emit('put', 'insert')">插入 ,</el-button>
        <el-button size="small" :disabled="!target" title="在播放头处覆盖：替换原有内容（.）" @click="emit('put', 'overwrite')">覆盖 .</el-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch, type CSSProperties } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-vue";
import type { VideoClip, VideoTrack } from "../types";
import type { Media } from "../media";
import { markAt, rangeClip, sourceDragType, type SourceMarks } from "../sourceEdit";
import { clipLength, timecode } from "../timeline";
import { useWheelZoom, zoomSteps } from "../viewZoom";

/** 源监视器中打开的文件：整段文件片段（类型、时长、像素尺寸）。 */
export interface SourceFile { path: string; clip: VideoClip }
/** 页面快捷键在源监视器激活时的控制入口。 */
export interface SourceControl { time: () => number; toggle: () => void; seek: (time: number) => void }

/**
 * Premiere 的源监视器：单独播放素材，标记入点与出点（I / O），在播放头处插入（,）或覆盖（.），也可从画面或 ⠿ 手柄拖到轨道上。
 */
const props = defineProps<{ source: SourceFile | null; marks: SourceMarks; fps: number; active: boolean; targets: VideoTrack[]; target: string | null }>();
const emit = defineEmits<{ marks: [marks: SourceMarks]; activate: []; target: [id: string]; put: [mode: "insert" | "overwrite"]; close: []; control: [control: SourceControl | null] }>();
const media = inject<Media>("videoMedia")!;
const mediaElement = ref<HTMLMediaElement>();
const barElement = ref<HTMLElement>();
const viewElement = ref<HTMLElement>();
const time = ref(0);
const playing = ref(false);
const src = ref("");
const zoom = ref<number | null>(null);
const natural = ref({ w: 0, h: 0 });
const area = ref({ w: 0, h: 0 });
const clip = computed(() => props.source?.clip);
const still = computed(() => clip.value?.kind === "image");
const duration = computed(() => (clip.value ? clip.value.srcDuration ?? clip.value.out : 0));
const range = computed(() => (clip.value ? rangeClip(clip.value, props.marks) : null));
const markIn = computed(() => props.marks.in ?? 0);
const markOut = computed(() => props.marks.out ?? duration.value);
const fitScale = computed(() => (natural.value.w && natural.value.h ? Math.max(0, Math.min((area.value.w - 16) / natural.value.w, (area.value.h - 16) / natural.value.h)) : 1));
const scale = computed(() => zoom.value ?? fitScale.value);
const size = computed<CSSProperties | undefined>(() => (natural.value.w ? { width: `${Math.floor(natural.value.w * scale.value)}px`, height: `${Math.floor(natural.value.h * scale.value)}px`, maxWidth: "none", maxHeight: "none" } : undefined));
const isZoomed = computed(() => !!size.value && zoom.value !== null && (natural.value.w * scale.value > area.value.w - 16 || natural.value.h * scale.value > area.value.h - 16));
const percent = (value: number) => `${duration.value ? (value / duration.value) * 100 : 0}%`;
const setNatural = (w: number, h: number) => { natural.value = { w, h }; };
const sync = () => { if (mediaElement.value) time.value = mediaElement.value.currentTime; };

let held: ReturnType<Media["acquire"]> | undefined;
watch(() => props.source?.path, path => {
  time.value = props.marks.in ?? 0;
  playing.value = false;
  natural.value = { w: 0, h: 0 };
  src.value = "";
  held?.release();
  held = undefined;
  if (!path) return;
  const current = held = media.acquire(path);
  void current.url.then(url => { if (held === current) src.value = url; }, () => {});
}, { immediate: true });
onBeforeUnmount(() => {
  held?.release();
  held = undefined;
});

let observer: ResizeObserver | undefined;
watch(viewElement, element => {
  observer?.disconnect();
  if (!element) return;
  const measure = () => { area.value = { w: element.clientWidth, h: element.clientHeight }; };
  measure();
  observer = new ResizeObserver(measure);
  observer.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());
useWheelZoom(viewElement, () => scale.value, value => { if (clip.value?.kind !== "audio") zoom.value = value; });

function seek(value: number) {
  const next = Math.max(0, Math.min(value, duration.value));
  if (mediaElement.value) mediaElement.value.currentTime = next;
  time.value = next;
}

function toggle() {
  const element = mediaElement.value;
  if (!element || still.value) return;
  if (element.paused) {
    if (element.currentTime >= duration.value - 1e-2) element.currentTime = props.marks.in ?? 0;
    void element.play().catch(() => {});
  } else element.pause();
}

watch([() => props.source, still], () => emit("control", props.source && !still.value ? { time: () => mediaElement.value?.currentTime ?? time.value, toggle, seek } : null), { immediate: true });

// 播放时以媒体元素为时钟（timeupdate 每秒只触发几次）。
let frame = 0;
watch(playing, value => {
  cancelAnimationFrame(frame);
  if (!value) return;
  const tick = () => {
    if (mediaElement.value) time.value = mediaElement.value.currentTime;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  emit("control", null);
});

function scrub(event: PointerEvent) {
  if (event.button !== 0 || !duration.value) return;
  const rect = barElement.value!.getBoundingClientRect();
  const at = (x: number) => ((x - rect.left) / rect.width) * duration.value;
  mediaElement.value?.pause();
  seek(at(event.clientX));
  const move = (moveEvent: PointerEvent) => seek(at(moveEvent.clientX));
  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}

function dragRange(event: DragEvent) {
  if (!props.source || !event.dataTransfer) return;
  event.dataTransfer.setData(sourceDragType, props.source.path);
  event.dataTransfer.setData("text/plain", props.source.path);
  event.dataTransfer.effectAllowed = "copy";
}
</script>

<style lang="scss">
.sourceMonitor {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  border: 1px solid transparent;

  &.active { border-color: color-mix(in srgb, var(--el-color-primary) 50%, transparent); }

  .sourceEmpty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 20px; color: var(--el-text-color-secondary); font-size: 12px; text-align: center; }
  .sourceView { display: flex; flex: 1; min-height: 0; align-items: center; justify-content: center; overflow: hidden; background: #111; cursor: pointer; }
  .sourceView.zoomed { display: block; overflow: auto; }
  .sourceView img, .sourceView video { max-width: 100%; max-height: 100%; }
  .sourceAudio { color: #fff; font-size: 14px; }
  .sourceBar { position: relative; height: 14px; margin: 4px 10px; border-radius: 3px; background: var(--el-fill-color-darker); cursor: pointer; }
  .sourceRange { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--el-color-primary) 35%, transparent); }
  .sourceMark { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--el-color-primary); }
  .sourceHead { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: #f03e3e; }
  .sourceGrip { display: inline-flex; color: var(--el-text-color-secondary); cursor: grab; }
}

.monitorHead, .monitorControls {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 8px;
  font-size: 12px;

  .spacer { flex: 1; }
  .monitorTitle { font-weight: 600; }
  .monitorFile { overflow: hidden; color: var(--el-text-color-secondary); text-overflow: ellipsis; white-space: nowrap; }
  .monitorTime { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
  .zoomPick { width: 110px; }
  .targetPick { width: 96px; }
  .el-button + .el-button { margin-left: 0; }

  .iconButton {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--el-text-color-regular);
    cursor: pointer;

    &:hover:not(:disabled) { background: var(--el-fill-color-light); }
    &:disabled { opacity: 0.4; cursor: default; }
    &.on { color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 12%, transparent); }
  }

  .markButton {
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--el-border-color);
    border-radius: 4px;
    background: none;
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;

    &.on { border-color: var(--el-color-primary); color: var(--el-color-primary); }
  }
}
</style>
