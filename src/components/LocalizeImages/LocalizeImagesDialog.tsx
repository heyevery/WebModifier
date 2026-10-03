// src/components/LocalizeImages/LocalizeImagesDialog.tsx
// 外链图片本地化（#10④）：扫描工作区内所有 http(s)/协议相对的图片引用
// （img/source src、srcset、video poster、<style> 与 CSS 文件里的 url()），
// 勾选后一键下载到 assets/external/ 并改写引用。下载失败的链接原样保留并列明原因，
// 保证不破坏现有页面（成功本地化 / 失败保留 / 未选择 三态）。

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import { toast } from '@/components/Toast/toast';
import type {
  ExternalImage,
  FailedImageItem,
  LocalizedImageItem
} from '@shared/external-images';

type Phase = 'loading' | 'list' | 'running' | 'report';

interface Report {
  localized: LocalizedImageItem[];
  failed: FailedImageItem[];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function LocalizeImagesDialog({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const scanExternalImages = useTemplateStore((s) => s.scanExternalImages);
  const localizeImages = useTemplateStore((s) => s.localizeImages);
  const imageLocalizing = useTemplateStore((s) => s.imageLocalizing);

  const [phase, setPhase] = useState<Phase>('loading');
  const [images, setImages] = useState<ExternalImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<Report>({ localized: [], failed: [] });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setReport({ localized: [], failed: [] });
    void (async () => {
      const list = await scanExternalImages();
      if (cancelled) return;
      if (list) {
        setImages(list);
        setSelected(new Set(list.map((i) => i.url)));
        setPhase('list');
      } else {
        setImages([]);
        setSelected(new Set());
        setPhase('list'); // store.error 已在状态栏提示
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allSelected = images.length > 0 && selected.size === images.length;

  function toggle(url: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(images.map((i) => i.url)));
  }

  async function handleLocalize(): Promise<void> {
    if (selected.size === 0 || imageLocalizing) return;
    setPhase('running');
    const urls = images.filter((i) => selected.has(i.url)).map((i) => i.url);
    const res = await localizeImages(urls);
    if (!res) {
      setPhase('list');
      toast.error('外链图片本地化失败，请查看状态栏错误');
      return;
    }
    setReport({ localized: res.localized, failed: res.failed });
    setPhase('report');
    if (res.localized.length > 0) {
      toast.success(`已本地化 ${res.localized.length} 张外链图片${res.failed.length ? `，${res.failed.length} 张失败保留` : ''}`);
    } else {
      toast.error('所选图片均下载失败，外链已原样保留');
    }
  }

  const locationText = (img: ExternalImage): string => {
    const htmlCount = img.locations.filter((l) => l.kind === 'html').length;
    const cssCount = img.locations.length - htmlCount;
    const parts: string[] = [];
    if (htmlCount > 0) parts.push(`${htmlCount} 个页面`);
    if (cssCount > 0) parts.push(`${cssCount} 个 CSS`);
    return `${parts.join(' · ')} · 命中 ${img.occurrences} 处`;
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
          onClick={() => !imageLocalizing && onClose()}
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            className="w-[600px] max-h-[85vh] flex flex-col bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 pb-3">
              <div className="text-sm font-medium text-wt-text mb-1">外链图片本地化</div>
              <div className="text-xs text-wt-muted leading-relaxed">
                把页面与样式中引用的网络图片下载到工作区
                <span className="font-mono text-wt-text"> assets/external/ </span>
                并改写为本地相对路径，导出的站点即可离线打开。
                <b className="text-wt-text">模板原件快照不受影响</b>；下载失败的链接会原样保留。
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-3">
              {phase === 'loading' && (
                <div className="py-10 text-center text-xs text-wt-muted">正在扫描全部页面与样式文件…</div>
              )}

              {phase === 'list' && images.length === 0 && (
                <div className="py-10 text-center">
                  <div className="text-2xl mb-2">🖼️</div>
                  <div className="text-xs text-wt-muted">未发现外链图片，站点引用的图片都已在本地。</div>
                </div>
              )}

              {phase === 'list' && images.length > 0 && (
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-[11px] text-wt-muted cursor-pointer select-none pb-1 border-b border-wt-border">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="accent-wt-primary"
                    />
                    <span>全选（共 {images.length} 张不同图片）</span>
                  </label>
                  {images.map((img) => {
                    const checked = selected.has(img.url);
                    return (
                      <label
                        key={img.url}
                        className={`flex items-start gap-2.5 p-2 rounded-md border cursor-pointer transition-colors ${
                          checked
                            ? 'border-wt-primary/40 bg-wt-primary/5'
                            : 'border-wt-border bg-wt-bg hover:bg-wt-surface-2'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(img.url)}
                          className="mt-0.5 accent-wt-primary flex-shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className="block text-[11px] font-mono text-wt-text truncate"
                            title={img.url}
                          >
                            {img.url}
                          </span>
                          <span className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] px-1 py-px rounded bg-wt-surface-2 text-wt-muted border border-wt-border">
                              {hostOf(img.url)}
                            </span>
                            <span className="text-[10px] text-wt-muted">{locationText(img)}</span>
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {phase === 'running' && (
                <div className="py-10 text-center">
                  <div className="inline-block w-5 h-5 border-2 border-wt-primary/30 border-t-wt-primary rounded-full animate-spin mb-3" />
                  <div className="text-xs text-wt-muted">
                    正在下载 {selected.size} 张图片并改写引用，请稍候…
                  </div>
                </div>
              )}

              {phase === 'report' && (
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] font-medium text-wt-success mb-1.5">
                      ✓ 已本地化 {report.localized.length} 张
                    </div>
                    <div className="space-y-1">
                      {report.localized.map((item) => (
                        <div
                          key={item.url}
                          className="p-2 rounded-md border border-wt-border bg-wt-bg"
                        >
                          <div className="text-[11px] font-mono text-wt-text truncate" title={item.url}>
                            {item.url}
                          </div>
                          <div className="text-[10px] text-wt-muted mt-0.5 font-mono">
                            → {item.sitePath}
                            {item.bytes > 0 ? ` · ${(item.bytes / 1024).toFixed(0)} KB` : ''} · 改写 {item.files.length} 个文件
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {report.failed.length > 0 && (
                    <div>
                      <div className="text-[11px] font-medium text-wt-danger mb-1.5">
                        ✗ {report.failed.length} 张失败，外链已原样保留
                      </div>
                      <div className="space-y-1">
                        {report.failed.map((item) => (
                          <div
                            key={item.url}
                            className="p-2 rounded-md border border-wt-danger/30 bg-wt-danger/5"
                          >
                            <div className="text-[11px] font-mono text-wt-text truncate" title={item.url}>
                              {item.url}
                            </div>
                            <div className="text-[10px] text-wt-danger/90 mt-0.5">{item.reason}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-wt-border">
              {phase === 'report' ? (
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white transition-colors"
                >
                  完成
                </button>
              ) : (
                <>
                  <button
                    onClick={onClose}
                    disabled={imageLocalizing || phase === 'running'}
                    className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-40 transition-colors"
                  >
                    取消
                  </button>
                  {phase === 'list' && images.length > 0 && (
                    <button
                      onClick={() => void handleLocalize()}
                      disabled={selected.size === 0 || imageLocalizing}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {imageLocalizing ? '下载中…' : `下载并本地化（${selected.size}）`}
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
