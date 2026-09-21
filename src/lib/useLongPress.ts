import { useCallback, useEffect, useRef, useState } from 'react';

const TICK_MS = 50;

/**
 * 长按触发。用 pointer 事件而不是 click —— click 没有"按住"的概念。
 *
 * 移动端的坑：iOS 长按会弹系统菜单、选中文本，所以触发区域必须配
 * `-webkit-touch-callout: none` + `user-select: none`（见 styles.css）。
 * 手指移出、页面被滚走都会触发 pointercancel/pointerleave，必须取消计时，
 * 否则会出现"松手了但登录框还是弹出来"的诡异现象。
 */
export function useLongPress(onComplete: () => void, durationMs = 5000) {
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number | null>(null);
  // 用 ref 存回调，避免父组件每次渲染传入新函数导致计时被重置
  const callbackRef = useRef(onComplete);
  callbackRef.current = onComplete;

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (timerRef.current !== null) return;
    const startedAt = Date.now();

    timerRef.current = window.setInterval(() => {
      const ratio = Math.min(1, (Date.now() - startedAt) / durationMs);
      setProgress(ratio);

      if (ratio >= 1) {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setProgress(0);
        callbackRef.current();
      }
    }, TICK_MS);
  }, [durationMs]);

  useEffect(() => cancel, [cancel]);

  return {
    progress,
    handlers: {
      onPointerDown: start,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // 阻止长按选中文本 / 触发系统菜单
      onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    },
  };
}
