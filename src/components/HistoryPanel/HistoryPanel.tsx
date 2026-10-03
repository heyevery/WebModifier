// src/components/HistoryPanel/HistoryPanel.tsx
// 历史面板：展示编辑历史，支持点击回滚 + 撤销/重做按钮

import { motion } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export function HistoryPanel() {
  const history = useTemplateStore((s) => s.history);
  const historyIndex = useTemplateStore((s) => s.historyIndex);
  const undo = useTemplateStore((s) => s.undo);
  const redo = useTemplateStore((s) => s.redo);
  const jumpToHistory = useTemplateStore((s) => s.jumpToHistory);
  const navHistory = useTemplateStore((s) => s.navHistory);
  const navIndex = useTemplateStore((s) => s.navIndex);
  const navigateBack = useTemplateStore((s) => s.navigateBack);
  const navigateForward = useTemplateStore((s) => s.navigateForward);

  // 倒序展示（最新在前）
  const reversed = [...history].reverse();
  const reversedStartIndex = history.length - 1;

  return (
    <aside className="w-[260px] flex-shrink-0 h-full bg-wt-surface border-r border-wt-border flex flex-col">
      <div className="px-3 py-2 border-b border-wt-border flex items-center justify-between">
        <div className="text-[10px] text-wt-muted uppercase tracking-[0.15em]">历史</div>
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={historyIndex < 0}
            className="w-6 h-6 flex items-center justify-center rounded text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
            title="撤销 (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            className="w-6 h-6 flex items-center justify-center rounded text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
            title="重做 (Ctrl+Y)"
          >
            ↷
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {/* 导航历史 */}
        <div className="px-2 py-1.5">
          <div className="text-[9px] text-wt-muted uppercase mb-1 px-1 flex items-center justify-between">
            <span>导航</span>
            <span className="flex gap-1">
              <button
                onClick={navigateBack}
                disabled={navIndex <= 0}
                className="text-wt-muted hover:text-wt-text disabled:opacity-30"
              >
                ◀
              </button>
              <button
                onClick={navigateForward}
                disabled={navIndex >= navHistory.length - 1}
                className="text-wt-muted hover:text-wt-text disabled:opacity-30"
              >
                ▶
              </button>
            </span>
          </div>
          {navHistory.length > 0 ? (
            <div className="space-y-0.5">
              {navHistory.map((page, i) => (
                <div
                  key={`${page}-${i}`}
                  className={`text-[11px] font-mono px-2 py-1 rounded ${
                    i === navIndex
                      ? 'bg-wt-primary/15 text-wt-primary'
                      : 'text-wt-muted'
                  }`}
                >
                  {page}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-wt-muted text-[11px] px-2 py-1">无导航记录</div>
          )}
        </div>

        <div className="border-t border-wt-border mx-2 my-1" />

        {/* 编辑历史 */}
        <div className="px-2 py-1.5">
          <div className="text-[9px] text-wt-muted uppercase mb-1 px-1">编辑操作</div>
          {reversed.length > 0 ? (
            <div className="space-y-0.5">
              {/* 初始状态：点击回到模板打开时（所有编辑撤销） */}
              <button
                onClick={() => jumpToHistory(-1)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                  historyIndex === -1
                    ? 'bg-wt-primary/15 text-wt-text'
                    : 'text-wt-muted hover:bg-wt-surface-2 hover:text-wt-text'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate font-medium">↺ 打开时的初始状态</span>
                </div>
                <div className="text-[10px] text-wt-muted truncate mt-0.5">撤销全部编辑</div>
              </button>
              {reversed.map((entry, revIdx) => {
                const realIndex = reversedStartIndex - revIdx;
                const isCurrent = realIndex === historyIndex;
                return (
                  <motion.button
                    key={entry.id}
                    onClick={() => jumpToHistory(realIndex)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                      isCurrent
                        ? 'bg-wt-primary/15 text-wt-text'
                        : 'text-wt-muted hover:bg-wt-surface-2 hover:text-wt-text'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate font-medium">{entry.regionLabel}</span>
                      <span className="text-[9px] text-wt-muted flex-shrink-0">
                        {formatTime(entry.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[9px] px-1 py-px rounded bg-wt-surface-2 text-wt-muted font-mono flex-shrink-0">
                        {entry.page}
                      </span>
                      <span className="text-[10px] text-wt-muted truncate">
                        {entry.oldValue.slice(0, 24) || '(空)'} → {entry.newValue.slice(0, 24) || '(空)'}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          ) : (
            <div className="text-wt-muted text-[11px] px-2 py-1">暂无编辑记录</div>
          )}
        </div>
      </div>
    </aside>
  );
}
