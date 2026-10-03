// src/components/SiteCodeDialog/SiteCodeDialog.tsx
// 全站自定义代码：head/body 两段 HTML/JS 代码（统计、客服浮窗、站长验证等）。
// 与 CSS 隔离同构：只存会话与项目草稿，模板本体不动；预览实时生效，导出时注入每个页面。

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';

export function SiteCodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const headInjection = useTemplateStore((s) => s.headInjection);
  const bodyInjection = useTemplateStore((s) => s.bodyInjection);
  const setSiteInjections = useTemplateStore((s) => s.setSiteInjections);

  // 对话框内本地编辑，点「保存」才提交（避免输入半截脚本就在预览中执行）
  const [head, setHead] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (open) {
      setHead(headInjection);
      setBody(bodyInjection);
    }
  }, [open, headInjection, bodyInjection]);

  function handleSave(): void {
    setSiteInjections({ head, body });
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            className="w-[560px] max-h-[88vh] overflow-y-auto bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-wt-text mb-1">自定义代码</div>
            <div className="text-xs text-wt-muted leading-relaxed mb-4">
              粘贴第三方服务提供的代码（网站统计、在线客服、搜索引擎站长验证等），保存后预览立即生效，
              导出时自动添加到<b className="text-wt-text">每一个页面</b>。代码只保存在当前项目草稿中，
              <b className="text-wt-text">不会修改模板原件</b>。
            </div>

            <label className="block mb-4">
              <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1 flex items-center gap-1.5">
                <span className="font-mono text-wt-accent">&lt;/head&gt; 前</span>
                <span>· 统计脚本、meta 验证、全站样式</span>
              </div>
              <textarea
                value={head}
                onChange={(e) => setHead(e.target.value)}
                placeholder={'<!-- 例如百度统计 / Google Analytics -->\n<script>…</script>'}
                rows={7}
                spellCheck={false}
                className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-[11px] font-mono leading-relaxed text-wt-text placeholder:text-wt-muted/50 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-wt-primary/40 resize-y"
              />
            </label>

            <label className="block mb-5">
              <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1 flex items-center gap-1.5">
                <span className="font-mono text-wt-accent">&lt;/body&gt; 前</span>
                <span>· 在线客服浮窗、挂件、必须延迟加载的脚本</span>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'<!-- 例如在线客服 / 悬浮挂件代码 -->\n<div>…</div>\n<script>…</script>'}
                rows={7}
                spellCheck={false}
                className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-[11px] font-mono leading-relaxed text-wt-text placeholder:text-wt-muted/50 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-wt-primary/40 resize-y"
              />
            </label>

            <div className="flex items-center justify-between">
              <div className="text-[10px] text-wt-muted/70 leading-snug max-w-[320px]">
                提示：代码会原样插入，请勿粘贴来源不明的脚本。清除内容并保存即可移除。
              </div>
              <div className="flex justify-end gap-2 flex-shrink-0">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={!currentTemplate}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  保存并应用
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
