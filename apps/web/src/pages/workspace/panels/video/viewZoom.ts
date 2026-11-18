import { watchEffect, type Ref } from "vue";

/** 监视器缩放档位：每视频像素对应的屏幕像素（1 = 100%）。 */
export const zoomSteps = [0.1, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** 从当前显示比例向上（1）或向下（-1）跳一档。 */
export function stepZoom(shown: number, direction: 1 | -1): number {
  const next = direction > 0 ? zoomSteps.find(step => step > shown * 1.01) : [...zoomSteps].reverse().find(step => step < shown * 0.99);
  return next ?? (direction > 0 ? zoomSteps.at(-1)! : zoomSteps[0]!);
}

/** Ctrl + 滚轮在 `box` 上缩放；使用非被动监听以阻止页面缩放。 */
export function useWheelZoom(box: Ref<HTMLElement | undefined>, scale: () => number, onZoom: (zoom: number) => void) {
  watchEffect(onCleanup => {
    const element = box.value;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      onZoom(Math.min(4, Math.max(0.05, Math.round(scale() * (event.deltaY < 0 ? 1.15 : 1 / 1.15) * 100) / 100)));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    onCleanup(() => element.removeEventListener("wheel", wheel));
  });
}
