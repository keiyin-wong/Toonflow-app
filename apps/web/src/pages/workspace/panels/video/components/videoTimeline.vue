<template>
  <div ref="scroller" class="videoTimeline" @pointermove="move" @pointerup="up" @pointercancel="up">
    <div ref="grid" class="timelineGrid" :style="{ width: `${headWidth + width}px` }">
      <div class="timelineRow rulerRow">
        <div class="trackHead rulerHead"><liveTime :format="value => timecode(value, doc.fps)" /></div>
        <div class="timelineRuler" :style="{ width: `${width}px` }" @pointerdown="startScrub">
          <div v-if="range.in !== null || range.out !== null" class="programRange" :style="{ left: `${(range.in ?? 0) * pps}px`, width: `${Math.max(1, ((range.out ?? length) - (range.in ?? 0)) * pps)}px` }"
            :title="rangeTitle" />
          <div v-for="tick in ticks" :key="tick.time" class="rulerTick" :class="{ major: tick.major }" :style="{ left: `${tick.time * pps}px` }">
            <span v-if="tick.major">{{ tick.label }}</span>
          </div>
          <div v-for="marker in doc.markers" :key="marker.id" class="timelineMarker" :style="{ left: `${marker.time * pps}px` }" :title="marker.label || translate('标记')"
            @pointerdown.stop="emit('seek', marker.time)" @contextmenu.stop.prevent="emit('menu', $event, { marker: marker.id }, marker.time)">
            <span v-if="marker.label">{{ marker.label }}</span>
          </div>
        </div>
      </div>
      <div v-for="track in doc.tracks" :key="track.id" class="timelineRow" :class="track.kind" :style="{ height: `${rowHeight(track)}px` }">
        <div class="trackHead" :class="[track.kind, { magnetic: track.magnetic }]" @contextmenu.prevent="emit('menu', $event, { track }, time)">
          <div class="rowGrip" title="拖动调整轨道高度 · 双击恢复默认" @pointerdown="startRowResize($event, track)" @dblclick="emit('height', track.id, null)" />
          <span class="trackName" :title="track.magnetic ? translate('磁性轨：片段首尾相接') : track.name">{{ track.name }}<icon-magnet v-if="track.magnetic" :size="12" aria-hidden="true" /></span>
          <button v-if="track.kind !== 'audio'" class="trackButton" :class="{ off: track.hidden }" :title="track.hidden ? translate('显示此轨') : translate('隐藏此轨')" @click="toggle(track, 'hidden')">
            <component :is="track.hidden ? IconEyeOff : IconEye" :size="14" />
          </button>
          <button v-if="track.kind !== 'text'" class="trackButton" :class="{ off: track.muted }" :title="track.muted ? translate('取消静音') : translate('静音此轨')" @click="toggle(track, 'muted')">
            <component :is="track.muted ? IconVolumeOff : IconVolume" :size="14" />
          </button>
          <button class="trackButton" :class="{ on: track.locked }" :title="track.locked ? translate('解锁') : translate('锁定（时间线上不可编辑）')" @click="toggle(track, 'locked')">
            <component :is="track.locked ? IconLock : IconLockOpen" :size="14" />
          </button>
        </div>
        <div :ref="element => setLane(track.id, element as HTMLElement | null)" class="trackLane" :class="[track.kind, { over: dropAt?.track === track.id, hidden: track.hidden, locked: track.locked }]" :style="{ width: `${width}px` }"
          @pointerdown.self="startMarquee" @contextmenu.self.prevent="emit('menu', $event, { track }, timeAt($event.clientX))"
          @dragover="dragOver($event, track)" @dragleave="dropAt = null" @drop="drop($event, track)">
          <template v-if="track.kind === 'text'">
            <div v-for="text in doc.texts.filter(item => item.track === track.id)" :key="text.id" class="timelineClip text" :class="{ shape: text.shape, selected: isSelected(text.id), hiddenItem: text.hidden }"
              :style="{ left: `${text.start * pps}px`, width: `${Math.max(2, text.duration * pps)}px` }" :title="text.shape ? `${text.shape.kind}${text.text.trim() ? `: ${text.text}` : ''}` : text.text"
              @pointerdown="startMove($event, text.id, !!track.locked)" @contextmenu.stop.prevent="openMenu($event, text.id, track)">
              <span class="clipName">{{ text.hidden ? "🚫 " : "" }}{{ text.shape ? `◆ ${text.shape.kind}${text.text.trim() ? ` · ${text.text.trim()}` : ""}` : text.text.trim() || translate("空文字") }}</span>
              <template v-if="!track.locked">
                <div class="clipEdge start" @pointerdown="startTrim($event, text.id, 'start', text.start)" />
                <div class="clipEdge end" @pointerdown="startTrim($event, text.id, 'end', text.start + text.duration)" />
              </template>
            </div>
          </template>
          <template v-else>
            <div v-for="clip in doc.clips.filter(item => item.track === track.id)" :key="clip.id" class="timelineClip" :class="[track.kind, clip.kind, { selected: isSelected(clip.id), muted: clip.muted, hiddenItem: clip.hidden }]"
              :style="{ left: `${places.get(clip.id)!.start * pps}px`, width: `${clipWidth(clip.id)}px` }" :title="clipTitle(clip)"
              @pointerdown="startMove($event, clip.id, !!track.locked)" @contextmenu.stop.prevent="openMenu($event, clip.id, track)">
              <span v-if="places.get(clip.id)!.into" class="clipTransition" :style="{ width: `${places.get(clip.id)!.into!.d * pps}px` }" :title="`${transitionNames[places.get(clip.id)!.into!.kind]} ${places.get(clip.id)!.into!.d.toFixed(2)}s`" />
              <clipFilmstrip v-if="track.kind === 'video' && clip.kind !== 'effect' && clipWidth(clip.id) > 12" :clip="clip" :left="places.get(clip.id)!.start * pps" :width="clipWidth(clip.id)" :height="rowHeight(track) - 6" :pps="pps" :view="view" />
              <clipWaveform v-if="track.kind === 'audio' && clipWidth(clip.id) > 8" :clip="clip" />
              <span class="clipName">{{ clipLabel(clip) }}</span>
              <span v-if="clip.kind !== 'effect' && hasFx(clip)" class="clipFx" title="已添加效果">fx</span>
              <span v-for="key in keyTimes(clip).filter(value => value <= places.get(clip.id)!.end - places.get(clip.id)!.start + 1e-3)" :key="key" class="clipKey" :style="{ left: `${key * pps}px` }"
                :title="keyTitle(places.get(clip.id)!.start + key)" @pointerdown.stop="emit('seek', places.get(clip.id)!.start + key)" />
              <template v-if="!track.locked">
                <div class="clipEdge start" @pointerdown="startTrim($event, clip.id, 'start', places.get(clip.id)!.start)" />
                <div class="clipEdge end" @pointerdown="startTrim($event, clip.id, 'end', places.get(clip.id)!.end)" />
              </template>
            </div>
          </template>
          <span v-if="!doc.clips.some(clip => clip.track === track.id) && !doc.texts.some(text => text.track === track.id)" class="trackHint">{{ trackHint(track) }}</span>
          <div v-if="dropAt?.track === track.id && dropX !== null" class="dropLine" :style="{ left: `${dropX}px` }" />
        </div>
      </div>
      <div class="timelineRow addRow">
        <div class="trackHead">
          <button class="addTrack" title="添加视频轨（绘制在前方）" @click="emit('addTrack', 'video')">＋ 视频</button>
          <button class="addTrack" title="添加音频轨" @click="emit('addTrack', 'audio')">＋ 音频</button>
          <button class="addTrack" title="添加文字轨" @click="emit('addTrack', 'text')">＋ 文字</button>
        </div>
      </div>
      <div v-if="range.in !== null" class="rangeLine" :style="{ left: `${headWidth + range.in * pps}px` }" />
      <div v-if="range.out !== null" class="rangeLine" :style="{ left: `${headWidth + range.out * pps}px` }" />
      <div v-if="box" class="marquee" :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }" />
      <div v-if="guide !== null" class="snapGuide" :style="{ left: `${headWidth + guide * pps}px` }" />
      <timelinePlayhead :offset="headWidth" :pps="pps" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { t, translate } from "@toonflow/i18n/vue";
import { IconEye, IconEyeOff, IconLock, IconLockOpen, IconVolume, IconVolumeOff } from "@tabler/icons-vue";
import type { VideoClip, VideoDoc, VideoTrack } from "../types";
import type { History } from "../useHistory";
import { assetDragType, onlineMusicDragType, sourceDragType } from "../sourceEdit";
import { docLength, fits, insertIndex, keyTimes, patchTexts, patchTracks, placeAll, placeClip, rulerSteps, snap, snapPoints, timecode, transitionNames, trim } from "../timeline";
import liveTime from "./liveTime.vue";
import timelinePlayhead from "./timelinePlayhead.vue";
import clipFilmstrip from "./clipFilmstrip.vue";
import clipWaveform from "./clipWaveform.vue";

/** 节目入点与出点（I / O）：提升、提取、循环与导出区间。 */
export interface ProgramRange { in: number | null; out: number | null }
export type MenuTarget = { item?: string; track?: VideoTrack; marker?: string };

const props = defineProps<{
  history: History<VideoDoc>;
  /** 页面提交的播放头（播放时每 250 毫秒更新），用于吸附与自动滚动。 */
  time: number;
  pps: number;
  selection: string[];
  snapping: boolean;
  heights: Record<string, number>;
  range: ProgramRange;
}>();
const emit = defineEmits<{
  pps: [pps: number]; select: [ids: string[]]; seek: [time: number]; drop: [paths: string[], track: VideoTrack, time: number]; sourceDrop: [track: VideoTrack, time: number]; onlineDrop: [music: { url: string; name: string }, track: VideoTrack, time: number];
  menu: [event: MouseEvent, target: MenuTarget, time: number]; addTrack: [kind: VideoTrack["kind"]]; height: [trackId: string, height: number | null];
}>();

const minPps = 4;
const maxPps = 400;
const snapPixels = 8;
const headWidth = 132;
const rowHeights = { video: 58, audio: 44, text: 36 } as const;
const minRow = 24;
const maxRow = 220;

type Drag =
  | { kind: "scrub" }
  | { kind: "marquee"; x0: number; y0: number; add: string[]; moved: boolean }
  | { kind: "move"; id: string; x0: number; moved: boolean; original: VideoDoc; start0: number; others: { id: string; start: number }[] }
  | { kind: "trim"; id: string; edge: "start" | "end"; x0: number; original: VideoDoc; edge0: number };

const doc = computed(() => props.history.content.value);
const scroller = ref<HTMLElement>();
const grid = ref<HTMLElement>();
const lanes = new Map<string, HTMLElement>();
let drag: Drag | null = null;
const dropAt = ref<{ track: string; t: number } | null>(null);
const guide = ref<number | null>(null);
const box = ref<{ x: number; y: number; w: number; h: number } | null>(null);
const view = ref({ left: 0, width: 1200 });
const places = computed(() => placeAll(doc.value));
const length = computed(() => docLength(doc.value, places.value));
const width = computed(() => (length.value + 30) * props.pps);
const isSelected = (id: string) => props.selection.includes(id);
const rowHeight = (track: VideoTrack) => props.heights[track.id] ?? rowHeights[track.kind];
const clipWidth = (id: string) => Math.max(2, (places.value.get(id)!.end - places.value.get(id)!.start) * props.pps);
const setLane = (id: string, element: HTMLElement | null) => (element ? lanes.set(id, element) : lanes.delete(id));

let observer: ResizeObserver | undefined;
let viewFrame = 0;
const readView = () => {
  cancelAnimationFrame(viewFrame);
  viewFrame = requestAnimationFrame(() => {
    const element = scroller.value;
    if (element) view.value = { left: Math.max(0, element.scrollLeft - headWidth), width: element.clientWidth };
  });
};
// Ctrl + 滚轮以鼠标为中心缩放。
function wheel(event: WheelEvent) {
  const element = scroller.value;
  if (!element || (!event.ctrlKey && !event.metaKey)) return;
  event.preventDefault();
  const t = timeAt(event.clientX);
  const next = Math.min(maxPps, Math.max(minPps, props.pps * Math.exp(-event.deltaY / 300)));
  emit("pps", next);
  requestAnimationFrame(() => { element.scrollLeft = t * next - (event.clientX - element.getBoundingClientRect().left - headWidth); });
}
onMounted(() => {
  const element = scroller.value!;
  readView();
  element.addEventListener("scroll", readView, { passive: true });
  element.addEventListener("wheel", wheel, { passive: false });
  observer = new ResizeObserver(readView);
  observer.observe(element);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(viewFrame);
  observer?.disconnect();
  scroller.value?.removeEventListener("scroll", readView);
  scroller.value?.removeEventListener("wheel", wheel);
});

// 播放头超出右侧时滚动跟随。
watch(() => [props.time, props.pps], () => {
  const element = scroller.value;
  if (!element || drag) return;
  const x = props.time * props.pps;
  const visible = element.clientWidth - headWidth;
  if (x > element.scrollLeft + visible - 40 || x < element.scrollLeft) element.scrollLeft = Math.max(0, x - 80);
});

/** 鼠标 x 处的时间。 */
function timeAt(clientX: number) {
  const element = scroller.value!;
  return Math.max(0, (clientX - element.getBoundingClientRect().left - headWidth + element.scrollLeft) / props.pps);
}
/** 鼠标 y 处的轨道。 */
function trackAt(clientY: number): VideoTrack | undefined {
  for (const track of doc.value.tracks) {
    const rect = lanes.get(track.id)?.getBoundingClientRect();
    if (rect && clientY >= rect.top && clientY < rect.bottom) return track;
  }
}

function startScrub(event: PointerEvent) {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag = { kind: "scrub" };
  emit("seek", timeAt(event.clientX));
}

const startOf = (id: string) => places.value.get(id)?.start ?? doc.value.texts.find(text => text.id === id)?.start ?? 0;
const isLocked = (id: string) => {
  const track = doc.value.clips.find(clip => clip.id === id)?.track ?? doc.value.texts.find(text => text.id === id)?.track;
  return !!doc.value.tracks.find(item => item.id === track)?.locked;
};

function startMove(event: PointerEvent, id: string, locked: boolean) {
  if (event.button !== 0) return;
  event.stopPropagation();
  if (event.shiftKey || event.ctrlKey || event.metaKey) return emit("select", isSelected(id) ? props.selection.filter(item => item !== id) : [...props.selection, id]);
  const selection = isSelected(id) ? props.selection : [id];
  if (!isSelected(id)) emit("select", [id]);
  if (locked) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  // 其他选中的自由轨内容按相同距离一起移动。
  const magneticId = doc.value.tracks.find(track => track.magnetic)!.id;
  const others = selection.filter(item => item !== id && doc.value.clips.find(clip => clip.id === item)?.track !== magneticId && !isLocked(item)).map(item => ({ id: item, start: startOf(item) }));
  drag = { kind: "move", id, x0: event.clientX, moved: false, original: doc.value, start0: startOf(id), others };
}

function startTrim(event: PointerEvent, id: string, edge: "start" | "end", edge0: number) {
  if (event.button !== 0) return;
  event.stopPropagation();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  emit("select", [id]);
  props.history.begin();
  drag = { kind: "trim", id, edge, x0: event.clientX, original: doc.value, edge0 };
}

/** 轨道空白处：单击移动播放头，拖动框选（Shift 追加）。 */
function startMarquee(event: PointerEvent) {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  const add = event.shiftKey || event.ctrlKey || event.metaKey ? props.selection : [];
  if (!add.length) emit("select", []);
  drag = { kind: "marquee", x0: event.clientX, y0: event.clientY, add, moved: false };
}

function marquee(state: Extract<Drag, { kind: "marquee" }>, event: PointerEvent) {
  if (!state.moved && Math.hypot(event.clientX - state.x0, event.clientY - state.y0) < 4) return;
  state.moved = true;
  const rect = grid.value!.getBoundingClientRect();
  const [x1, x2] = [Math.min(state.x0, event.clientX), Math.max(state.x0, event.clientX)];
  const [y1, y2] = [Math.min(state.y0, event.clientY), Math.max(state.y0, event.clientY)];
  box.value = { x: x1 - rect.left, y: y1 - rect.top, w: x2 - x1, h: y2 - y1 };
  const [t1, t2] = [timeAt(x1), timeAt(x2)];
  const tracks = new Set(doc.value.tracks.filter(track => {
    const lane = lanes.get(track.id)?.getBoundingClientRect();
    return lane && lane.bottom > y1 && lane.top < y2;
  }).map(track => track.id));
  const hits = [
    ...doc.value.clips.filter(clip => tracks.has(clip.track) && places.value.get(clip.id)!.end > t1 && places.value.get(clip.id)!.start < t2).map(clip => clip.id),
    ...doc.value.texts.filter(text => tracks.has(text.track) && text.start + text.duration > t1 && text.start < t2).map(text => text.id),
  ];
  emit("select", [...new Set([...state.add, ...hits])]);
}

/** 拖动轨道头底边调整行高。 */
function startRowResize(event: PointerEvent, track: VideoTrack) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const [y0, h0] = [event.clientY, rowHeight(track)];
  const moveRow = (moveEvent: PointerEvent) => emit("height", track.id, Math.round(Math.min(maxRow, Math.max(minRow, h0 + moveEvent.clientY - y0))));
  const release = () => {
    removeEventListener("pointermove", moveRow);
    removeEventListener("pointerup", release);
  };
  addEventListener("pointermove", moveRow);
  addEventListener("pointerup", release);
}

function trackChanged(state: Extract<Drag, { kind: "move" }>, event: PointerEvent) {
  const own = state.original.clips.find(clip => clip.id === state.id)?.track ?? state.original.texts.find(text => text.id === state.id)?.track;
  const over = trackAt(event.clientY);
  return !!over && over.id !== own;
}

function move(event: PointerEvent) {
  const state = drag;
  if (!state) return;
  const history = props.history;
  if (state.kind === "scrub") return emit("seek", timeAt(event.clientX));
  if (state.kind === "marquee") return marquee(state, event);
  const dt = (event.clientX - state.x0) / props.pps;
  const originalPlaces = placeAll(state.original);
  const except = new Set([state.id, ...(state.kind === "move" ? state.others.map(item => item.id) : [])]);
  const points = () => snapPoints(state.original, originalPlaces, props.time, except);
  const threshold = (props.snapping ? snapPixels : 0) / props.pps;
  if (state.kind === "trim") {
    const clip = state.original.clips.find(item => item.id === state.id);
    const magneticStart = clip && state.edge === "start" && state.original.tracks.find(track => track.id === clip.track)?.magnetic;
    const snapped = magneticStart ? { t: state.edge0 + dt, to: null } : snap(state.edge0 + dt, points(), threshold);
    guide.value = snapped.to;
    history.live(trim(state.original, state.id, state.edge, snapped.t - state.edge0));
    return;
  }
  if (!state.moved && Math.abs(event.clientX - state.x0) < 4 && !trackChanged(state, event)) return;
  if (!state.moved) {
    state.moved = true;
    history.begin();
  }
  const clip = state.original.clips.find(item => item.id === state.id);
  const text = state.original.texts.find(item => item.id === state.id);
  const own = clip ? state.original.tracks.find(track => track.id === clip.track)! : state.original.tracks.find(track => track.id === text!.track)!;
  const over = trackAt(event.clientY);
  const target = over && !over.locked && (clip ? fits(clip, over) : over.kind === "text") ? over : own;
  const span = (originalPlaces.get(state.id)?.end ?? (text ? text.start + text.duration : 0)) - state.start0;
  if (target.magnetic) {
    // 拖到 V1：显示插入位置，松开时放入。
    guide.value = null;
    dropAt.value = { track: target.id, t: timeAt(event.clientX) };
    if (!own.magnetic) history.live(state.original);
    return;
  }
  dropAt.value = null;
  const a = snap(Math.max(0, state.start0 + dt), points(), threshold);
  const b = snap(Math.max(0, state.start0 + dt) + span, points(), threshold);
  const start = Math.max(0, a.to !== null ? a.t : b.to !== null ? b.t - span : state.start0 + dt);
  guide.value = a.to ?? b.to;
  const shift = start - state.start0;
  let next = clip ? placeClip(state.original, state.id, target.id, { start }) : patchTexts(state.original, [state.id], () => ({ start, track: target.id }));
  for (const other of state.others) {
    const otherClip = next.clips.find(item => item.id === other.id);
    next = otherClip ? placeClip(next, other.id, otherClip.track, { start: Math.max(0, other.start + shift) }) : patchTexts(next, [other.id], () => ({ start: Math.max(0, other.start + shift) }));
  }
  history.live(next);
}

function up(event: PointerEvent) {
  const state = drag;
  drag = null;
  guide.value = null;
  const target = dropAt.value;
  dropAt.value = null;
  box.value = null;
  if (state?.kind === "marquee") {
    if (!state.moved) emit("seek", timeAt(event.clientX));
    return;
  }
  if (!state || state.kind === "scrub") return;
  if (state.kind === "trim" || !state.moved) return props.history.end();
  if (target) props.history.live(placeClip(state.original, state.id, target.track, { index: insertIndex(state.original, timeAt(event.clientX), state.id) }));
  props.history.end();
}

// 素材面板拖入的文件与源监视器的标记区间。
function dragOver(event: DragEvent, track: VideoTrack) {
  const types = event.dataTransfer?.types ?? [];
  if (!(types.includes(assetDragType) || types.includes(sourceDragType) || types.includes(onlineMusicDragType)) || track.locked) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = "copy";
  dropAt.value = { track: track.id, t: timeAt(event.clientX) };
}

function drop(event: DragEvent, track: VideoTrack) {
  dropAt.value = null;
  if (track.locked || !event.dataTransfer) return;
  if (event.dataTransfer.types.includes(sourceDragType)) {
    event.preventDefault();
    return emit("sourceDrop", track, timeAt(event.clientX));
  }
  const music = event.dataTransfer.getData(onlineMusicDragType);
  if (music) {
    event.preventDefault();
    return emit("onlineDrop", JSON.parse(music) as { url: string; name: string }, track, timeAt(event.clientX));
  }
  const raw = event.dataTransfer.getData(assetDragType);
  if (!raw) return;
  event.preventDefault();
  emit("drop", JSON.parse(raw) as string[], track, timeAt(event.clientX));
}

function openMenu(event: MouseEvent, id: string, track: VideoTrack) {
  if (!isSelected(id)) emit("select", [id]);
  emit("menu", event, { item: id, track }, timeAt(event.clientX));
}

const ticks = computed(() => {
  const { step, label } = rulerSteps(props.pps);
  const list: { time: number; major: boolean; label: string }[] = [];
  for (let t = 0; t * props.pps < width.value; t += step) {
    const value = Math.round(t * 1000) / 1000;
    const major = Math.abs(value / label - Math.round(value / label)) < 1e-6;
    list.push({ time: value, major, label: value >= 60 ? `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}` : `${value}s` });
  }
  return list;
});

/** 放置指示线：V1 上位于片段间隙，其他轨位于鼠标时间。 */
const dropX = computed(() => {
  if (!dropAt.value) return null;
  const track = doc.value.tracks.find(item => item.id === dropAt.value!.track);
  if (!track?.magnetic) return dropAt.value.t * props.pps;
  const skip = drag?.kind === "move" ? drag.id : undefined;
  const index = insertIndex(doc.value, dropAt.value.t, skip);
  const onTrack = doc.value.clips.filter(clip => clip.track === track.id && clip.id !== skip);
  return onTrack.slice(0, index).reduce((x, clip) => x + (places.value.get(clip.id)!.end - places.value.get(clip.id)!.start), 0) * props.pps;
});

const hasFx = (clip: VideoClip) => !!(clip.mask || clip.crop || clip.kenBurns || clip.moveTo || clip.rotation || (clip.opacity ?? 1) < 1 || (clip.brightness ?? 1) !== 1 || (clip.contrast ?? 1) !== 1 || (clip.saturation ?? 1) !== 1 || clip.fadeIn || clip.fadeOut || (clip.scale ?? 1) !== 1 || clip.fit || clip.hue || clip.sepia || clip.grayscale || clip.blur);
const clipLabel = (clip: VideoClip) => `${clip.kind === "effect" ? "✨ " : ""}${clip.hidden ? "🚫 " : ""}${clip.muted ? "🔇 " : ""}${(clip.speed ?? 1) !== 1 ? `${clip.speed}× ` : ""}${clip.blend && clip.blend !== "normal" ? `[${clip.blend}] ` : ""}${clip.name}`;
function clipTitle(clip: VideoClip) {
  const place = places.value.get(clip.id)!;
  const span = (place.end - place.start).toFixed(2);
  return clip.kind === "effect"
    ? t`${clip.name} · ${span} 秒 · 改变此轨之下的所有画面`
    : `${clip.name}\n${timecode(clip.in, doc.value.fps)} – ${timecode(clip.out, doc.value.fps)} · ${span}s`;
}
function trackHint(track: VideoTrack) {
  if (track.kind === "text") return translate("按 T 在播放头处添加文字 · 右键可导入 .srt");
  if (track.kind === "audio") return translate("把音乐或配音拖到这里");
  return track.magnetic ? translate("把视频和图片拖到这里") : translate("拖到这里叠加在 V1 之上");
}
const rangeTitle = computed(() => t`入点 ${timecode(props.range.in ?? 0, doc.value.fps)} · 出点 ${timecode(props.range.out ?? length.value, doc.value.fps)}`);
const keyTitle = (at: number) => t`${timecode(at, doc.value.fps)} 的关键帧 · 点击跳转`;
const toggle = (track: VideoTrack, key: "hidden" | "muted" | "locked") => props.history.set(patchTracks(doc.value, track.id, { [key]: !track[key] || undefined }));

defineExpose({ fit: () => (scroller.value?.clientWidth ?? 800), minPps, maxPps });
</script>

<style lang="scss">
.videoTimeline {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: 12px;
  user-select: none;

  .timelineGrid { position: relative; min-height: 100%; }

  .timelineRow {
    display: flex;
    border-bottom: 1px solid var(--el-border-color-lighter);

    &.rulerRow { position: sticky; top: 0; z-index: 30; height: 26px; background: var(--el-bg-color); }
    &.addRow { border-bottom: none; }
  }

  .trackHead {
    position: sticky;
    left: 0;
    z-index: 20;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    width: 132px;
    padding: 0 6px;
    box-sizing: border-box;
    border-right: 1px solid var(--el-border-color-lighter);
    background: var(--el-fill-color-light);

    &.rulerHead { justify-content: center; font-variant-numeric: tabular-nums; color: var(--el-text-color-secondary); }
    &.magnetic { background: color-mix(in srgb, var(--el-color-primary) 8%, var(--el-fill-color-light)); }

    .rowGrip { position: absolute; left: 0; right: 0; bottom: -3px; height: 6px; cursor: row-resize; }
    .trackName { display: flex; flex: 1; align-items: center; gap: 3px; min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }

    .trackButton {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: none;
      color: var(--el-text-color-regular);
      cursor: pointer;

      &:hover { background: var(--el-fill-color); }
      &.off { color: var(--el-text-color-placeholder); }
      &.on { color: var(--el-color-warning); }
    }

    .addTrack {
      padding: 2px 4px;
      border: none;
      border-radius: 4px;
      background: none;
      color: var(--el-text-color-secondary);
      font-size: 11px;
      cursor: pointer;

      &:hover { background: var(--el-fill-color); color: var(--el-text-color-primary); }
    }
  }

  .timelineRuler {
    position: relative;
    cursor: pointer;

    .programRange { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--el-color-primary) 20%, transparent); }
    .rulerTick {
      position: absolute;
      bottom: 0;
      width: 1px;
      height: 6px;
      background: var(--el-border-color);

      &.major { height: 12px; background: var(--el-text-color-placeholder); }
      span { position: absolute; bottom: 12px; left: 3px; color: var(--el-text-color-secondary); font-size: 10px; white-space: nowrap; }
    }
    .timelineMarker {
      position: absolute;
      top: 2px;
      width: 9px;
      height: 9px;
      margin-left: -4px;
      background: var(--el-color-warning);
      clip-path: polygon(50% 100%, 0 0, 100% 0);
      cursor: pointer;

      span { position: absolute; left: 10px; top: -2px; color: var(--el-color-warning); font-size: 10px; white-space: nowrap; }
    }
  }

  .trackLane {
    position: relative;
    flex-shrink: 0;

    &.over { background: color-mix(in srgb, var(--el-color-primary) 8%, transparent); }
    &.hidden { opacity: 0.5; }
    &.locked { background: repeating-linear-gradient(135deg, transparent 0 6px, var(--el-fill-color-lighter) 6px 12px); }

    .trackHint { position: absolute; left: 8px; top: 50%; color: var(--el-text-color-placeholder); font-size: 11px; transform: translateY(-50%); pointer-events: none; }
    .dropLine { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--el-color-primary); pointer-events: none; }
  }

  .timelineClip {
    position: absolute;
    top: 3px;
    bottom: 3px;
    box-sizing: border-box;
    overflow: hidden;
    border: 1px solid #00000033;
    border-radius: 4px;
    background: #3b6fd8;
    color: #fff;
    cursor: grab;

    &.audio { background: #2f9e6e; }
    &.text { background: #8b5cf6; }
    &.text.shape { background: #d9480f; }
    &.effect { background: linear-gradient(135deg, #c026d3, #7c3aed); }
    &.image { background: #4c6ef5; }
    &.selected { outline: 2px solid var(--el-color-warning); outline-offset: -1px; z-index: 5; }
    &.muted { opacity: 0.75; }
    &.hiddenItem { opacity: 0.45; }

    .clipFilm { position: absolute; inset: 0; background-size: auto 100%; background-repeat: repeat-x; opacity: 0.85; }
    .filmTile { position: absolute; top: 0; bottom: 0; background-repeat: no-repeat; }
    .clipWave { position: absolute; inset: 0; width: 100%; height: 100%; fill: #ffffffa6; }
    .clipName { position: relative; display: block; padding: 2px 6px; overflow: hidden; font-size: 11px; text-overflow: ellipsis; text-shadow: 0 1px 2px #0009; white-space: nowrap; }
    .clipFx { position: absolute; right: 6px; top: 2px; padding: 0 3px; border-radius: 3px; background: #0006; font-size: 10px; }
    .clipTransition { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #ffffff66, transparent); pointer-events: none; }
    .clipKey { position: absolute; bottom: 3px; width: 7px; height: 7px; margin-left: -3px; background: #ffd43b; transform: rotate(45deg); cursor: pointer; }
    .clipEdge { position: absolute; top: 0; bottom: 0; width: 6px; cursor: ew-resize; }
    .clipEdge.start { left: 0; }
    .clipEdge.end { right: 0; }
  }

  .rangeLine { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--el-color-primary); pointer-events: none; }
  .marquee { position: absolute; z-index: 40; border: 1px solid var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 12%, transparent); pointer-events: none; }
  .snapGuide { position: absolute; top: 0; bottom: 0; z-index: 35; width: 1px; background: var(--el-color-warning); pointer-events: none; }
  .timelinePlayhead { position: absolute; top: 0; bottom: 0; z-index: 36; width: 1px; background: #f03e3e; pointer-events: none; }
}
</style>
