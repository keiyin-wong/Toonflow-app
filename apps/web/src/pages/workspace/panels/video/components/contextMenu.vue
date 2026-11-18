<template>
  <teleport to="body">
    <div ref="menuElement" class="videoContextMenu" role="menu" :style="position" @contextmenu.prevent>
      <template v-for="(item, index) in items" :key="index">
        <div v-if="item === 'sep'" class="menuSeparator" role="separator" />
        <div v-else class="menuRow" :class="{ danger: item.danger, disabled: item.disabled }" role="menuitem" :aria-disabled="item.disabled" :title="item.hint"
          @pointerenter="openSub = item.submenu ? index : null" @click="choose(item)">
          <icon-check v-if="item.checked" class="menuCheck" :size="14" aria-hidden="true" />
          <span class="menuLabel">{{ item.label }}</span>
          <kbd v-if="item.keys" class="menuKeys">{{ item.keys }}</kbd>
          <icon-chevron-right v-if="item.submenu" :size="14" aria-hidden="true" />
          <div v-if="item.submenu && openSub === index" class="videoContextMenu subMenu" role="menu">
            <div v-for="(child, childIndex) in item.submenu" :key="childIndex" class="menuRow" :class="{ danger: child.danger, disabled: child.disabled }" role="menuitem" @click.stop="choose(child)">
              <icon-check v-if="child.checked" class="menuCheck" :size="14" aria-hidden="true" />
              <span class="menuLabel">{{ child.label }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

export type MenuItem = "sep" | { label: string; keys?: string; hint?: string; danger?: boolean; disabled?: boolean; checked?: boolean; onClick?: () => void; submenu?: Exclude<MenuItem, "sep">[] };

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>();
const emit = defineEmits<{ close: [] }>();
const menuElement = ref<HTMLElement>();
const openSub = ref<number | null>(null);
const size = ref({ width: 0, height: 0 });
const position = computed(() => ({
  left: `${Math.max(4, Math.min(props.x, innerWidth - size.value.width - 4))}px`,
  top: `${Math.max(4, Math.min(props.y, innerHeight - size.value.height - 4))}px`,
}));

function choose(item: Exclude<MenuItem, "sep">) {
  if (item.disabled || item.submenu) return;
  emit("close");
  item.onClick?.();
}

function outside(event: PointerEvent) {
  if (!menuElement.value?.contains(event.target as Node)) emit("close");
}

function key(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  emit("close");
}

onMounted(async () => {
  await nextTick();
  size.value = { width: menuElement.value?.offsetWidth ?? 0, height: menuElement.value?.offsetHeight ?? 0 };
  addEventListener("pointerdown", outside, true);
  addEventListener("keydown", key, true);
  addEventListener("blur", close);
});
onBeforeUnmount(() => {
  removeEventListener("pointerdown", outside, true);
  removeEventListener("keydown", key, true);
  removeEventListener("blur", close);
});

function close() {
  emit("close");
}
</script>

<style lang="scss">
.videoContextMenu {
  position: fixed;
  z-index: 3000;
  min-width: 200px;
  max-width: 320px;
  padding: 4px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
  font-size: 13px;
  color: var(--el-text-color-primary);

  &.subMenu {
    position: absolute;
    top: -4px;
    left: 100%;
  }

  .menuSeparator {
    height: 1px;
    margin: 4px 2px;
    background: var(--el-border-color-lighter);
  }

  .menuRow {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px 5px 24px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;

    &:hover { background: var(--el-fill-color-light); }
    &.danger { color: var(--el-color-danger); }
    &.disabled { color: var(--el-text-color-disabled); cursor: default; background: none; }

    .menuCheck { position: absolute; left: 6px; }
    .menuLabel { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .menuKeys { font-family: inherit; font-size: 11px; color: var(--el-text-color-secondary); }
  }
}
</style>
