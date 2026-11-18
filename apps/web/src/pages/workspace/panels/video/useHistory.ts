import { computed, shallowRef } from "vue";

const limit = 200;

/**
 * 带撤销 / 重做的文档。`set` 记录一步；拖动包含多次更新但只算一步：`begin` 记下起点，`live` 更新但不记录，`end` 在有变化时记录起点。
 */
export function useHistory<Content extends object>(initial: Content) {
  const content = shallowRef(initial);
  const past = shallowRef<Content[]>([]);
  const future = shallowRef<Content[]>([]);
  let started: Content | null = null;
  const resolve = (next: Content | ((value: Content) => Content)) => (typeof next === "function" ? next(content.value) : next);

  function record(previous: Content) {
    past.value = [...past.value.slice(-limit + 1), previous];
    future.value = [];
  }

  function set(next: Content | ((value: Content) => Content)) {
    const value = resolve(next);
    if (value === content.value) return;
    record(content.value);
    content.value = value;
  }

  function begin() {
    started ??= content.value;
  }

  function live(next: Content | ((value: Content) => Content)) {
    content.value = resolve(next);
  }

  function end() {
    if (started && started !== content.value) record(started);
    started = null;
  }

  function undo() {
    const previous = past.value.at(-1);
    if (!previous) return;
    past.value = past.value.slice(0, -1);
    future.value = [...future.value, content.value];
    content.value = previous;
  }

  function redo() {
    const next = future.value.at(-1);
    if (!next) return;
    future.value = future.value.slice(0, -1);
    past.value = [...past.value, content.value];
    content.value = next;
  }

  /** 打开了另一个文档：载入内容并清空历史。 */
  function reset(next: Content) {
    past.value = [];
    future.value = [];
    started = null;
    content.value = next;
  }

  return { content, set, begin, live, end, undo, redo, reset, canUndo: computed(() => past.value.length > 0), canRedo: computed(() => future.value.length > 0) };
}

export type History<Content extends object> = ReturnType<typeof useHistory<Content>>;
