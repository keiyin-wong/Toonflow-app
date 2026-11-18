<template>
  <label class="fieldRow" :class="{ keyed: $slots.default }">
    <span class="fieldLabel">{{ label }}</span>
    <el-input-number v-if="kind === 'number'" class="fieldControl" :modelValue="shown" size="small" :controls="false" :step="step" :min="min === undefined ? undefined : min * scale" :max="max === undefined ? undefined : max * scale"
      @keydown.stop @change="commit" />
    <el-slider v-else-if="kind === 'range'" class="fieldControl" :modelValue="Number(value)" size="small" :min="min" :max="max" :step="step" :showTooltip="false" @input="slide" @change="settle" />
    <el-select v-else-if="kind === 'pick'" class="fieldControl" :modelValue="String(value)" size="small" :teleported="true" @change="pick">
      <el-option v-for="option in options" :key="String(option.value)" :label="option.label" :value="String(option.value)" />
    </el-select>
    <input v-else class="fieldColor" type="color" :value="value" @focus="history?.begin()" @blur="history?.end()" @input="emit('live', ($event.target as HTMLInputElement).value as Value)" />
    <span class="fieldSuffix">{{ kind === "range" && format ? format(Number(value)) : suffix }}</span>
    <slot />
  </label>
</template>

<script setup lang="ts" generic="Value extends string | number">
import { computed } from "vue";
import type { History } from "../useHistory";
import type { VideoDoc } from "../types";

/**
 * 属性面板的一行：数字（回车或失焦生效）、滑块（拖动实时生效，整次拖动为一步撤销）、下拉选择或颜色。默认插槽放关键帧按钮。
 */
const props = withDefaults(defineProps<{
  label: string;
  kind: "number" | "range" | "pick" | "color";
  value: Value;
  options?: { value: Value; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  scale?: number;
  suffix?: string;
  format?: (value: number) => string;
  history?: History<VideoDoc>;
}>(), { options: () => [], step: 0.1, scale: 1, suffix: "" });
const emit = defineEmits<{ change: [value: Value]; live: [value: Value] }>();
const round = (value: number) => Math.round(value * 100) / 100;
const shown = computed(() => round(Number(props.value) * props.scale));
let sliding = false;

function commit(value: number | undefined) {
  if (value === undefined || value === null || !Number.isFinite(value)) return;
  const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, value / props.scale));
  if (round(clamped * props.scale) !== shown.value) emit("change", clamped as Value);
}

function slide(value: number | number[]) {
  if (!sliding) {
    sliding = true;
    props.history?.begin();
  }
  emit("live", (Array.isArray(value) ? value[0]! : value) as Value);
}

function settle() {
  sliding = false;
  props.history?.end();
}

function pick(value: unknown) {
  const option = props.options.find(item => String(item.value) === String(value));
  if (option) emit("change", option.value);
}
</script>

<style lang="scss">
.fieldRow {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  font-size: 12px;

  &.keyed { grid-template-columns: 84px minmax(0, 1fr) 44px auto; }

  .fieldLabel { overflow: hidden; color: var(--el-text-color-regular); text-overflow: ellipsis; white-space: nowrap; }
  .fieldControl { width: 100%; }
  .el-slider { padding: 0 6px; }
  .fieldColor { width: 100%; height: 24px; padding: 0; border: 1px solid var(--el-border-color); border-radius: 4px; background: none; cursor: pointer; }
  .fieldSuffix { overflow: hidden; color: var(--el-text-color-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
}
</style>
