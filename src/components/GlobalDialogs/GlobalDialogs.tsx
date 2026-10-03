// src/components/GlobalDialogs/GlobalDialogs.tsx
// 全局对话框宿主：新建工作区 / 导入模板。
// 常驻在 App 根部，命令面板、主页、资源管理器均可通过 intents 唤起，
// 避免对话框状态散落在多个组件、且面板未挂载时收不到意图。

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import { onIntent } from '@/lib/intents';

export function GlobalDialogs() {
  const createWorkspace = useTemplateStore((s) => s.createWorkspace);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const openTemplate = useTemplateStore((s) => s.openTemplate);

  const [wsOpen, setWsOpen] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsBusy, setWsBusy] = useState(false);

  const [importing, setImporting] = useState(false);

  async function handleImport(): Promise<void> {
    if (importing) return;
    setImporting(true);
    try {
      const res = await window.wt.importTemplate();
      if (res.canceled) return;
      await fetchTemplates();
      await openTemplate(res.name);
    } catch {
      // 导入对话框内的取消/异常无需打扰用户（IPC 层已有提示）
    } finally {
      setImporting(false);
    }
  }

  // 无依赖数组：订阅一次（onIntent 自带 cleanup），闭包随渲染刷新
  useEffect(() =>
    onIntent((id) => {
      if (id === 'new-workspace') {
        setWsName('');
        setWsOpen(true);
      } else if (id === 'import-template') {
        void handleImport();
      }
    })
  );

  async function confirmCreateWorkspace(): Promise<void> {
    const name = wsName.trim();
    if (wsBusy || !name) return;
    setWsBusy(true);
    try {
      const created = await createWorkspace(name);
      if (created) {
        setWsOpen(false);
        setWsName('');
      }
    } finally {
      setWsBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {wsOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center"
          onClick={() => !wsBusy && setWsOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            className="w-[380px] bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-wt-text mb-1">新建工作区</div>
            <div className="text-xs text-wt-muted leading-relaxed mb-3">
              将创建一个含起始页（标题、文字、链接三个可编辑区域）的空白工作区，
              之后可用「＋ 页面」把其他模板加为子页面。
            </div>
            <label className="block mb-4">
              <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1">
                工作区名称（支持中文；重名自动加后缀）
              </div>
              <input
                autoFocus
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmCreateWorkspace();
                }}
                placeholder="例如：我的网站"
                spellCheck={false}
                className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setWsOpen(false)}
                disabled={wsBusy}
                className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmCreateWorkspace}
                disabled={wsBusy || !wsName.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {wsBusy ? '创建中…' : '创建并打开'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
