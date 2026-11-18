<template>
  <div ref="barElement" class="scrubBar" :class="{ off: !length }" title="点击或拖动移动播放头" @pointerdown="down">
    <div class="scrubDone" :style="{ width: percent }" />
    <div class="scrubHead" :style="{ left: percent }" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, type ShallowRef } from "vue";

// 预览下方的进度条：点击或拖动移动播放头。
const props = defineProps<{ length: number }>();
const emit = defineEmits<{ seek: [time: number] }>();
const clock = inject<ShallowRef<number>>("videoClock")!;
const barElement = ref<HTMLElement>();
const percent = computed(() => (props.length ? `${Math.min(100, (clock.value / props.length) * 100)}%` : "0%"));

function down(event: PointerEvent) {
  if (!props.length || event.button !== 0) return;
  event.preventDefault();
  const at = (x: number) => {
    const rect = barElement.value!.getBoundingClientRect();
    emit("seek", Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * props.length);
  };
  at(event.clientX);
  const move = (moveEvent: PointerEvent) => at(moveEvent.clientX);
  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}
</script>

<style lang="scss">
.scrubBar {
  position: relative;
  height: 6px;
  margin: 0 10px;
  border-radius: 3px;
  background: var(--el-fill-color-darker);
  cursor: pointer;

  &.off { opacity: 0.4; cursor: default; }
  .scrubDone { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--el-color-primary); }
  .scrubHead { position: absolute; top: 50%; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1px #0003; transform: translateY(-50%); }
}
</style>
