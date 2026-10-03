// src/components/Toast/toast.ts
// 轻量全局通知：不依赖 React 上下文，任意模块（含 store/IPC 回调）都可直接调
// toast.success/error/info。状态用订阅器暴露，由 ToastHost 经
// useSyncExternalStore 消费。

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 2600,
  info: 3200,
  error: 5200 // 错误停留更久，方便读完
};

let items: ToastItem[] = [];
let seq = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToastItems(): ToastItem[] {
  return items;
}

/** 关闭单条；clear=true 表示被新通知顶掉（静默），false 表示手动/超时 */
export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, duration?: number): number {
  const id = seq++;
  items = [...items, { id, kind, message }];
  emit();
  const ms = duration ?? DEFAULT_DURATION[kind];
  timers.set(
    id,
    setTimeout(() => dismissToast(id), ms)
  );
  return id;
}

export const toast = {
  success: (message: string, duration?: number): number => push('success', message, duration),
  error: (message: string, duration?: number): number => push('error', message, duration),
  info: (message: string, duration?: number): number => push('info', message, duration)
};
