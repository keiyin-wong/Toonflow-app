<template>
  <span class="keyButtons" @click.prevent>
    <button v-if="keyed" class="keyNav" title="上一个关键帧" :disabled="previous === undefined" @click="previous !== undefined && emit('seek', place.start + previous)">‹</button>
    <button class="keyToggle" :class="{ on: keyed, here }" :disabled="!inside" :title="toggleTitle" @click="toggle">{{ here ? "◆" : "◇" }}</button>
    <el-select v-if="here" class="keyEase" :modelValue="easeAt(clip, keyProps, local) ?? 'linear'" size="small" title="从此关键帧到下一帧的变化方式" @change="setEase">
      <el-option v-for="ease in eases" :key="ease" :label="translate(easeLabels[ease])" :value="ease" />
    </el-select>
    <button v-if="keyed" class="keyNav" title="下一个关键帧" :disabled="next === undefined" @click="next !== undefined && emit('seek', place.start + next)">›</button>
    <button v-if="keyed" class="keyNav" title="停止动画（保留播放头处的值）" @click="stop">✕</button>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { VideoClip, VideoDoc, VideoEase, VideoKeyProp, VideoKeys } from "../types";
import type { History } from "../useHistory";
import { easeLabels } from "../labels";
import { centreAt, easeAt, eases, hasKeyAt, isKeyed, patchClips, propAt, tidyKeys, withEase, withKey, withoutKey, type Place } from "../timeline";

/**
 * 一个属性的关键帧按钮（位置为 x、y 一起）。◇ 在播放头处添加关键帧开始动画；之后 ◆ 增删播放头处的关键帧，‹ › 跳到前后关键帧，✕ 停止动画并保留当前值。
 */
const props = defineProps<{ clip: VideoClip; place: Place; time: number; keyProps: VideoKeyProp[]; history: History<VideoDoc> }>();
const emit = defineEmits<{ seek: [time: number] }>();
const local = computed(() => props.time - props.place.start);
const inside = computed(() => local.value >= -1e-3 && local.value <= props.place.end - props.place.start + 1e-3);
const keyed = computed(() => props.keyProps.some(prop => isKeyed(props.clip, prop)));
const here = computed(() => props.keyProps.some(prop => hasKeyAt(props.clip, prop, local.value)));
const times = computed(() => [...new Set(props.keyProps.flatMap(prop => (props.clip.keys?.[prop] ?? []).map(key => key.t)))].sort((a, b) => a - b));
const previous = computed(() => [...times.value].reverse().find(value => value < local.value - 1e-3));
const next = computed(() => times.value.find(value => value > local.value + 1e-3));
const toggleTitle = computed(() => !inside.value ? translate("先把播放头移到此片段内再设置关键帧") : !keyed.value ? translate("开始动画：在此处添加关键帧，再到其他位置修改数值") : here.value ? translate("删除此处的关键帧") : translate("在此处添加关键帧"));
const now = (prop: VideoKeyProp) => (prop === "x" || prop === "y" ? centreAt(props.clip, props.place, props.time)[prop] : propAt(props.clip, prop, props.place, props.time));
const apply = (patch: Partial<VideoClip>) => props.history.set(patchClips(props.history.content.value, [props.clip.id], patch));

function toggle() {
  const clip = props.clip;
  if (!inside.value) return;
  if (here.value) {
    let keys: VideoKeys | undefined = clip.keys;
    for (const prop of props.keyProps) keys = withoutKey({ ...clip, keys }, prop, local.value);
    return apply({ keys: tidyKeys(keys) });
  }
  let keys: VideoKeys | undefined = clip.keys;
  if (!keyed.value && props.keyProps.includes("x") && clip.moveTo) {
    // 滑动转换为起止两个关键帧，画面不跳变。
    const length = props.place.end - props.place.start;
    keys = { ...keys, x: [{ t: 0, v: clip.x ?? 0.5 }, { t: length, v: clip.moveTo.x }], y: [{ t: 0, v: clip.y ?? 0.5 }, { t: length, v: clip.moveTo.y }] };
  }
  for (const prop of props.keyProps) keys = withKey({ ...clip, keys }, prop, local.value, now(prop));
  apply({ keys, ...(props.keyProps.includes("x") && { moveTo: undefined }) });
}

function stop() {
  const fixed: Partial<VideoClip> = {};
  for (const prop of props.keyProps) (fixed as Record<string, number>)[prop] = Math.round(now(prop) * 1000) / 1000;
  const keys = { ...props.clip.keys };
  for (const prop of props.keyProps) delete keys[prop];
  apply({ ...fixed, keys: tidyKeys(keys) });
}

const setEase = (ease: VideoEase) => apply({ keys: withEase(props.clip, props.keyProps, local.value, ease) });
</script>

<style lang="scss">
.keyButtons {
  display: inline-flex;
  align-items: center;
  gap: 1px;

  button {
    min-width: 18px;
    height: 20px;
    padding: 0 3px;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    cursor: pointer;

    &:hover:not(:disabled) { background: var(--el-fill-color); }
    &:disabled { opacity: 0.35; cursor: default; }
  }

  .keyToggle.on { color: var(--el-color-warning); }
  .keyToggle.here { color: #f59f00; }
  .keyEase { width: 82px; }
}
</style>
