// src/components/AutosavePrompt/AutosavePrompt.tsx
// 打开工作区时发现上次未正常保存的自动草稿：询问恢复还是放弃

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';

function formatTime(ts: number): string {
  if (!ts) return '未知时间';
  try {
    const d = new Date(ts);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '未知时间';
  }
}

export function AutosavePrompt() {
  const pending = useTemplateStore((s) => s.pendingAutosave);
  const restoreAutosave = useTemplateStore((s) => s.restoreAutosave);
  const discardAutosave = useTemplateStore((s) => s.discardAutosave);
  const [busy, setBusy] = useState<'restore' | 'discard' | null>(null);

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            className="w-[420px] bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
          >
            <div className="text-sm font-medium text-wt-text mb-2">恢复上次未保存的内容？</div>
            <div className="text-xs text-wt-muted leading-relaxed mb-4">
              工作区 <span className="font-mono text-wt-text">{pending.templateName}</span>{' '}
              检测到上次退出时自动保存的草稿（{pending.editCount} 处内容修改
              {pending.cssCount ? `、${pending.cssCount} 个样式文件` : ''}
              {pending.injectionCount ? `、${pending.injectionCount} 段自定义代码` : ''}，
              更新于 {formatTime(pending.updatedAt)}）。
              <br />
              选择「恢复」可继续上次的编辑；选择「放弃」将永久删除该草稿。
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  if (busy) return;
                  setBusy('discard');
                  void discardAutosave().finally(() => setBusy(null));
                }}
                disabled={busy !== null}
                className="px-3.5 py-1.5 text-xs rounded-md text-wt-muted border border-wt-border hover:text-wt-danger hover:border-wt-danger/50 transition-colors disabled:opacity-40"
              >
                {busy === 'discard' ? '删除中…' : '放弃草稿'}
              </button>
              <button
                onClick={() => {
                  if (busy) return;
                  setBusy('restore');
                  void restoreAutosave().finally(() => setBusy(null));
                }}
                disabled={busy !== null}
                className="px-3.5 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy === 'restore' ? '恢复中…' : '恢复内容'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
