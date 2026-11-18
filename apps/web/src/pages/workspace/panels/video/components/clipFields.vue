<template>
  <div class="inspectorHead">{{ heading }}</div>
  <div class="inspectorScroll">
    <div class="inspectorTop">
      <div class="itemName" :title="clip.src">{{ clip.name }}</div>
      <div class="itemMeta">{{ timecode(place.start, doc.fps) }} – {{ timecode(place.end, doc.fps) }}</div>
    </div>

    <inspectorSection title="时长与速度" group="speed">
      <fieldRow v-if="clip.kind === 'image'" label="时长" kind="number" suffix="s" :value="clipLength(clip)" :min="minSeconds" @change="value => set({ in: 0, out: value })" />
      <template v-else>
        <fieldRow label="入点（文件）" kind="number" suffix="s" :value="clip.in" :min="0" :max="clip.out - minSeconds" @change="value => set({ in: value })" />
        <fieldRow label="出点（文件）" kind="number" suffix="s" :value="clip.out" :min="clip.in + minSeconds" :max="clip.srcDuration ?? Infinity" @change="value => set({ out: value })" />
        <fieldRow label="速度" kind="pick" :value="speeds.includes(clip.speed ?? 1) ? clip.speed ?? 1 : 0" :options="speedOptions" @change="value => value && set({ speed: value === 1 ? undefined : value })" />
        <fieldRow label="精确速度" kind="number" suffix="×" :step="0.05" :min="0.1" :max="10" :value="clip.speed ?? 1" @change="value => set({ speed: Math.abs(value - 1) < 1e-3 ? undefined : Math.round(value * 1000) / 1000 })" />
      </template>
      <fieldRow v-if="!track.magnetic" label="开始于" kind="number" suffix="s" :value="clip.start ?? 0" :min="0" @change="value => set({ start: value })" />
      <el-button v-if="visual && clip.kind === 'video'" size="small" :disabled="!insideNow" :title="insideNow ? translate('在此切开并把这一帧定格为 2 秒的图片') : translate('先把播放头移到此片段内')" @click="emit('freeze', clip.id)">
        <icon-snowflake :size="14" />&nbsp;在播放头处定格
      </el-button>
    </inspectorSection>

    <template v-if="visual">
      <inspectorSection title="运动" group="transform" resettable @reset="set({ fit: undefined, x: undefined, y: undefined, scale: undefined, rotation: undefined, moveTo: undefined, keys: tidyKeys({ ...clip.keys, x: undefined, y: undefined, scale: undefined, rotation: undefined }) })">
        <fieldRow label="填充画面" kind="pick" :value="clip.fit ?? 'fit'" :options="fitOptions" @change="value => set({ fit: value === 'fit' ? undefined : value as VideoClip['fit'] })" />
        <fieldRow label="位置 X" kind="number" suffix="%" :scale="100" :step="1" :value="value('x')" @change="value => setAt('x', value)">
          <keyButtons :clip="clip" :place="place" :time="time" :keyProps="['x', 'y']" :history="history" @seek="value => emit('seek', value)" />
        </fieldRow>
        <fieldRow label="位置 Y" kind="number" suffix="%" :scale="100" :step="1" :value="value('y')" @change="value => setAt('y', value)" />
        <fieldRow label="缩放" kind="range" :value="value('scale')" :min="0.05" :max="4" :step="0.01" :history="history" :format="percent" @live="value => setAt('scale', value, true)">
          <keyButtons :clip="clip" :place="place" :time="time" :keyProps="['scale']" :history="history" @seek="value => emit('seek', value)" />
        </fieldRow>
        <fieldRow label="旋转" kind="range" :value="value('rotation')" :min="-180" :max="180" :step="1" :history="history" :format="degrees" @live="value => setAt('rotation', value, true)">
          <keyButtons :clip="clip" :place="place" :time="time" :keyProps="['rotation']" :history="history" @seek="value => emit('seek', value)" />
        </fieldRow>
        <p v-if="isKeyed(clip, 'x') || isKeyed(clip, 'scale') || isKeyed(clip, 'rotation')" class="fieldHint">已开启动画：显示的是播放头处的数值，修改会在此处写入关键帧（时间线片段上的 ◆）。</p>
        <el-checkbox v-if="!isKeyed(clip, 'x') && !isKeyed(clip, 'y')" :modelValue="!!clip.moveTo" size="small" @change="value => set({ moveTo: value ? { x: clip.x ?? 0.5, y: clip.y ?? 0.5 } : undefined })">结束时滑动到另一位置</el-checkbox>
        <template v-if="clip.moveTo && !isKeyed(clip, 'x') && !isKeyed(clip, 'y')">
          <fieldRow label="终点 X" kind="number" suffix="%" :scale="100" :step="1" :value="clip.moveTo.x" @change="value => set({ moveTo: { ...clip.moveTo!, x: value } })" />
          <fieldRow label="终点 Y" kind="number" suffix="%" :scale="100" :step="1" :value="clip.moveTo.y" @change="value => set({ moveTo: { ...clip.moveTo!, y: value } })" />
        </template>
        <p class="fieldHint">在预览中拖动片段可移动，拖动角点可缩放。</p>
      </inspectorSection>

      <inspectorSection title="Ken Burns（推拉摇移）" group="transform" :open="!!clip.kenBurns">
        <fieldRow label="运动方式" kind="pick" :value="kenBurnsName" :options="kenBurnsOptions" @change="value => value !== 'custom' && set({ kenBurns: kenBurnsPresets[value] ?? undefined })" />
        <template v-if="clip.kenBurns">
          <fieldRow label="起始缩放" kind="number" suffix="×" :step="0.05" :min="1" :value="clip.kenBurns.from.zoom" @change="value => setKenBurns('from', 'zoom', value)" />
          <fieldRow label="结束缩放" kind="number" suffix="×" :step="0.05" :min="1" :value="clip.kenBurns.to.zoom" @change="value => setKenBurns('to', 'zoom', value)" />
          <fieldRow label="起始焦点 X" kind="number" suffix="%" :scale="100" :step="1" :value="clip.kenBurns.from.x" @change="value => setKenBurns('from', 'x', value)" />
          <fieldRow label="结束焦点 X" kind="number" suffix="%" :scale="100" :step="1" :value="clip.kenBurns.to.x" @change="value => setKenBurns('to', 'x', value)" />
          <fieldRow label="起始焦点 Y" kind="number" suffix="%" :scale="100" :step="1" :value="clip.kenBurns.from.y" @change="value => setKenBurns('from', 'y', value)" />
          <fieldRow label="结束焦点 Y" kind="number" suffix="%" :scale="100" :step="1" :value="clip.kenBurns.to.y" @change="value => setKenBurns('to', 'y', value)" />
        </template>
      </inspectorSection>

      <inspectorSection title="不透明度、混合与裁切" group="blend" :open="!!(clip.crop || (clip.opacity ?? 1) < 1 || isKeyed(clip, 'opacity') || clip.blend || clip.hidden)" resettable
        @reset="set({ opacity: undefined, blend: undefined, hidden: undefined, crop: undefined, keys: tidyKeys({ ...clip.keys, opacity: undefined }) })">
        <el-checkbox :modelValue="!!clip.hidden" size="small" @change="value => set({ hidden: Boolean(value) || undefined })">隐藏（不绘制画面，声音照常）</el-checkbox>
        <fieldRow label="混合模式" kind="pick" :value="clip.blend ?? 'normal'" :options="blendOptions" @change="value => set({ blend: value === 'normal' ? undefined : value as VideoBlend })" />
        <fieldRow label="不透明度" kind="range" :value="value('opacity')" :min="0" :max="1" :step="0.01" :history="history" :format="percent"
          @live="value => (isKeyed(clip, 'opacity') ? setAt('opacity', value, true) : live({ opacity: value >= 1 ? undefined : value }))">
          <keyButtons :clip="clip" :place="place" :time="time" :keyProps="['opacity']" :history="history" @seek="value => emit('seek', value)" />
        </fieldRow>
        <fieldRow v-for="side in cropSides" :key="side.key" :label="side.label" kind="range" :value="clip.crop?.[side.key] ?? 0" :min="0" :max="0.9" :step="0.005" :history="history" :format="percent" @live="value => setCrop(side.key, value)" />
      </inspectorSection>

      <inspectorSection title="边框（相片）" group="blend" :open="!!clip.border" :resettable="!!clip.border" @reset="set({ border: undefined })">
        <fieldRow label="宽度" kind="range" :value="clip.border?.width ?? 0" :min="0" :max="0.15" :step="0.005" :history="history" :format="value => (value ? percent(value) : translate('无'))"
          @live="value => live({ border: value ? { width: value, color: clip.border?.color ?? '#ffffff' } : undefined })" />
        <fieldRow v-if="clip.border" label="颜色" kind="color" :value="clip.border.color" :history="history" @live="value => live({ border: { ...clip.border!, color: value } })" />
      </inspectorSection>

      <inspectorSection title="蒙版" group="masks" :open="!!clip.mask" :resettable="!!clip.mask" @reset="set({ mask: undefined })">
        <maskFields :clip="clip" :history="history" />
      </inspectorSection>

      <inspectorSection title="调色与滤镜" group="effects" :open="lookOf(clip) !== 'none' || !!clip.blur" resettable @reset="set(colorReset)">
        <colorFields :clip="clip" :history="history" />
      </inspectorSection>

      <inspectorSection title="淡入淡出与转场" group="effects" :open="!!(clip.fadeIn || clip.fadeOut || clip.transition)">
        <fieldRow label="淡入" kind="number" suffix="s" :value="clip.fadeIn ?? 0" :min="0" :max="clipLength(clip)" @change="value => set({ fadeIn: value || undefined })" />
        <fieldRow label="淡出" kind="number" suffix="s" :value="clip.fadeOut ?? 0" :min="0" :max="clipLength(clip)" @change="value => set({ fadeOut: value || undefined })" />
        <template v-if="track.magnetic && !first">
          <fieldRow label="从上一片段" kind="pick" :value="clip.transition?.kind ?? 'cut'" :options="transitionOptions" @change="value => set(withTransition(clip, value as VideoTransitionKind | 'cut'))" />
          <fieldRow v-if="clip.transition" label="时长" kind="number" suffix="s" :value="clip.transition.duration" :min="0.05" :max="5" @change="value => set({ transition: { ...clip.transition!, duration: value } })" />
          <fieldRow v-if="clip.transition && transitionDirected.includes(clip.transition.kind)" label="方向" kind="pick" :value="clip.transition.direction ?? 'left'" :options="directionOptions"
            @change="value => set({ transition: { ...clip.transition!, direction: value as VideoDirection } })" />
          <p v-if="place.into && clip.transition && place.into.d < clip.transition.duration - 0.01" class="fieldHint">相邻片段不够长，已缩短为 {{ place.into.d.toFixed(2) }} 秒。</p>
        </template>
      </inspectorSection>
    </template>

    <inspectorSection v-if="clip.kind !== 'image'" title="音频" group="audio" resettable @reset="set({ volume: undefined, muted: undefined, audioFadeIn: undefined, audioFadeOut: undefined, keys: tidyKeys({ ...clip.keys, volume: undefined }) })">
      <fieldRow label="音量" kind="range" :value="value('volume')" :min="0" :max="2" :step="0.01" :history="history" :format="percent"
        @live="value => (isKeyed(clip, 'volume') ? setAt('volume', value, true) : live({ volume: value === 1 ? undefined : value }))">
        <keyButtons :clip="clip" :place="place" :time="time" :keyProps="['volume']" :history="history" @seek="value => emit('seek', value)" />
      </fieldRow>
      <p v-if="isKeyed(clip, 'volume')" class="fieldHint">音量关键帧：例如在人声处压低音乐（在台词开始处点 ◇，稍后再降低音量）。</p>
      <el-checkbox :modelValue="!!clip.muted" size="small" @change="value => set({ muted: Boolean(value) || undefined })">静音</el-checkbox>
      <fieldRow label="淡入" kind="number" suffix="s" :value="clip.audioFadeIn ?? 0" :min="0" @change="value => set({ audioFadeIn: value || undefined })" />
      <fieldRow label="淡出" kind="number" suffix="s" :value="clip.audioFadeOut ?? 0" :min="0" @change="value => set({ audioFadeOut: value || undefined })" />
      <el-button v-if="visual && clip.kind === 'video'" size="small" title="把声音放到音频轨上成为独立片段，并将视频静音" @click="emit('detachAudio', clip.id)">分离音频</el-button>
    </inspectorSection>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, type Ref } from "vue";
import { msg, translate } from "@toonflow/i18n/vue";
import type { VideoBlend, VideoClip, VideoDirection, VideoDoc, VideoKeyProp, VideoTransitionKind } from "../types";
import type { History } from "../useHistory";
import { blendLabels, directionLabels, fitLabels, kenBurnsLabels, transitionLabels } from "../labels";
import { lookOf } from "../presets";
import { blends, centreAt, clipLength, directions, isKeyed, minSeconds, patchClips, placeAll, propAt, sequence, setProp, tidyKeys, timecode, transitionDirected, transitionKinds, transitionSeconds } from "../timeline";
import fieldRow from "./fieldRow.vue";
import inspectorSection from "./inspectorSection.vue";
import keyButtons from "./keyButtons.vue";
import maskFields from "./maskFields.vue";
import colorFields from "./colorFields.vue";

const props = defineProps<{ clip: VideoClip; history: History<VideoDoc>; time: number }>();
const emit = defineEmits<{ seek: [time: number]; detachAudio: [id: string]; freeze: [id: string] }>();
const shownGroup = inject<Ref<string | null>>("inspectorGroup", ref(null));
const groupTitles: Record<string, ReturnType<typeof msg>> = { transform: msg`变换`, audio: msg`音频`, speed: msg`时长与速度`, blend: msg`不透明度与混合`, masks: msg`蒙版`, effects: msg`效果` };

const doc = computed(() => props.history.content.value);
const track = computed(() => doc.value.tracks.find(item => item.id === props.clip.track)!);
const places = computed(() => placeAll(doc.value));
const place = computed(() => places.value.get(props.clip.id)!);
const visual = computed(() => track.value.kind === "video");
const first = computed(() => track.value.magnetic && sequence(doc.value, places.value)[0]?.clip.id === props.clip.id);
const heading = computed(() => {
  const group = groupTitles[shownGroup.value ?? ""];
  if (group) return translate(group);
  return `${props.clip.kind === "image" ? translate("图片") : track.value.kind === "audio" ? translate("音频片段") : translate("视频片段")} · ${track.value.name}`;
});
// 可动画的属性显示播放头处的值（片段外取边缘值），开启动画后修改即在此写关键帧。
const at = computed(() => Math.min(place.value.end, Math.max(place.value.start, props.time)));
const insideNow = computed(() => props.time > place.value.start + 1e-3 && props.time < place.value.end - 1e-3);
const value = (prop: VideoKeyProp) => (prop === "x" || prop === "y" ? centreAt(props.clip, place.value, at.value)[prop] : propAt(props.clip, prop, place.value, at.value));
const current = () => props.history.content.value.clips.find(item => item.id === props.clip.id) ?? props.clip;
const set = (patch: Partial<VideoClip>) => props.history.set(patchClips(props.history.content.value, [props.clip.id], patch));
const live = (patch: Partial<VideoClip>) => props.history.live(patchClips(props.history.content.value, [props.clip.id], patch));

function setAt(prop: VideoKeyProp, next: number, now = false) {
  const fresh = current();
  const patch = isKeyed(fresh, prop) ? setProp(fresh, place.value, prop, at.value, next) : ({ [prop]: next } as Partial<VideoClip>);
  if (now) live(patch);
  else set(patch);
}

function setKenBurns(end: "from" | "to", key: "zoom" | "x" | "y", next: number) {
  const kenBurns = props.clip.kenBurns!;
  set({ kenBurns: { ...kenBurns, [end]: { ...kenBurns[end], [key]: next } } });
}

function setCrop(side: "left" | "top" | "right" | "bottom", next: number) {
  const crop = { left: 0, top: 0, right: 0, bottom: 0, ...current().crop, [side]: next };
  live({ crop: crop.left || crop.top || crop.right || crop.bottom ? crop : undefined });
}

const percent = (next: number) => `${Math.round(next * 100)}%`;
const degrees = (next: number) => `${Math.round(next)}°`;
const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const speedOptions = computed(() => [...(speeds.includes(props.clip.speed ?? 1) ? [] : [{ value: 0, label: `${props.clip.speed}×` }]), ...speeds.map(speed => ({ value: speed, label: `${speed}×` }))]);
const fitOptions = computed(() => (["fit", "fill", "blur"] as const).map(fit => ({ value: fit as string, label: translate(fitLabels[fit]) })));
const blendOptions = computed(() => blends.map(blend => ({ value: blend as string, label: translate(blendLabels[blend]) })));
const directionOptions = computed(() => directions.map(direction => ({ value: direction as string, label: translate(directionLabels[direction]) })));
const transitionOptions = computed(() => [{ value: "cut", label: translate("硬切") }, ...transitionKinds.map(kind => ({ value: kind as string, label: translate(transitionLabels[kind]) }))]);
const cropSides = computed(() => [
  { key: "left" as const, label: translate("裁切左") }, { key: "top" as const, label: translate("裁切上") },
  { key: "right" as const, label: translate("裁切右") }, { key: "bottom" as const, label: translate("裁切下") },
]);
const colorReset: Partial<VideoClip> = { brightness: undefined, contrast: undefined, saturation: undefined, hue: undefined, sepia: undefined, grayscale: undefined, blur: undefined };

const kenBurnsPresets: Record<string, VideoClip["kenBurns"] | null> = {
  none: null,
  zoomIn: { from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.3, x: 0.5, y: 0.5 } },
  zoomOut: { from: { zoom: 1.3, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } },
  panLeft: { from: { zoom: 1.25, x: 0.7, y: 0.5 }, to: { zoom: 1.25, x: 0.3, y: 0.5 } },
  panRight: { from: { zoom: 1.25, x: 0.3, y: 0.5 }, to: { zoom: 1.25, x: 0.7, y: 0.5 } },
  panUp: { from: { zoom: 1.25, x: 0.5, y: 0.7 }, to: { zoom: 1.25, x: 0.5, y: 0.3 } },
  panDown: { from: { zoom: 1.25, x: 0.5, y: 0.3 }, to: { zoom: 1.25, x: 0.5, y: 0.7 } },
};
const kenBurnsName = computed(() => Object.entries(kenBurnsPresets).find(([, preset]) => JSON.stringify(preset ?? null) === JSON.stringify(props.clip.kenBurns ?? null))?.[0] ?? "custom");
const kenBurnsOptions = computed(() => [...Object.keys(kenBurnsPresets), ...(kenBurnsName.value === "custom" ? ["custom"] : [])].map(name => ({ value: name, label: translate(kenBurnsLabels[name]!) })));

/** 切换转场类型：沿用已设置的时长（否则用该类型默认时长），有方向的类型带方向。 */
function withTransition(clip: VideoClip, kind: VideoTransitionKind | "cut"): Partial<VideoClip> {
  return {
    transition: kind === "cut" ? undefined : {
      kind, duration: clip.transition?.duration ?? transitionSeconds[kind],
      ...(transitionDirected.includes(kind) && { direction: clip.transition?.direction ?? "left" }),
    },
  };
}
</script>
