// src/components/Toast/ToastHost.tsx
// 右下角通知栈：success/error/info，自动消失，也可手动关闭。

import { useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  dismissToast,
  getToastItems,
  subscribeToast,
  type ToastKind
} from './toast';

const KIND_STYLE: Record<ToastKind, { icon: string; bar: string; iconCls: string }> = {
  success: { icon: '✓', bar: 'bg-wt-success', iconCls: 'text-wt-success' },
  error: { icon: '✕', bar: 'bg-wt-danger', iconCls: 'text-wt-danger' },
  info: { icon: 'i', bar: 'bg-wt-primary', iconCls: 'text-wt-primary' }
};

export function ToastHost() {
  const items = useSyncExternalStore(subscribeToast, getToastItems, getToastItems);

  return (
    <div className="fixed right-3 bottom-9 z-[120] flex flex-col items-end gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {items.map((t) => {
          const st = KIND_STYLE[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, transition: { duration: 0.15 } }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="pointer-events-auto flex items-start gap-2.5 w-[320px] max-w-[80vw]
                         bg-wt-surface border border-wt-border rounded-md shadow-wt-lg
                         pl-0 pr-2 py-2.5 overflow-hidden"
              role="alert"
            >
              <span className={`w-0.5 self-stretch rounded-full flex-shrink-0 ${st.bar}`} />
              <span
                className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full
                           border border-current text-[11px] font-bold leading-none mt-px ${st.iconCls}`}
              >
                {st.icon}
              </span>
              <span className="flex-1 text-[12px] leading-snug text-wt-text break-words pt-0.5">
                {t.message}
              </span>
              <button
                onClick={() => dismissToast(t.id)}
                className="flex-shrink-0 w-5 h-5 -mt-0.5 text-wt-muted hover:text-wt-text
                           hover:bg-wt-surface-2 rounded-sm text-[12px] leading-none
                           flex items-center justify-center transition-colors"
                title="关闭"
              >
                ×
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
