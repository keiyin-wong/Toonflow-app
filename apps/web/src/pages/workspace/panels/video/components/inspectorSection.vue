<template>
  <details v-if="!shownGroup || group === shownGroup" class="inspectorSection" :open="shownGroup ? true : open">
    <summary>
      <span>{{ title }}</span>
      <button v-if="resettable" class="resetButton" title="重置" @click.prevent="emit('reset')"><icon-refresh :size="13" /></button>
    </summary>
    <div class="sectionBody"><slot /></div>
  </details>
</template>

<script setup lang="ts">
import { inject, ref, type Ref } from "vue";

// 属性面板的折叠分组；分组导航选中某组时只显示该组。
withDefaults(defineProps<{ title: string; open?: boolean; group?: string; resettable?: boolean }>(), { open: true });
const emit = defineEmits<{ reset: [] }>();
const shownGroup = inject<Ref<string | null>>("inspectorGroup", ref(null));
</script>

<style lang="scss">
.inspectorSection {
  border-bottom: 1px solid var(--el-border-color-lighter);

  summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    list-style: none;

    span { flex: 1; }
  }

  .resetButton { display: inline-flex; padding: 2px; border: none; border-radius: 4px; background: none; color: var(--el-text-color-secondary); cursor: pointer; }
  .resetButton:hover { background: var(--el-fill-color); }
  .sectionBody { display: flex; flex-direction: column; gap: 4px; padding: 0 12px 10px; }
}
</style>
