// src/components/Resizer/Resizer.tsx
// 三栏布局的拖拽分隔条：pointer 事件拖动调整左右面板宽度，宽度持久化在 store。
// 拖拽期间给 body 加 wt-resizing 类：全局列宽光标、禁止选中文本、
// iframe 临时 pointer-events:none（否则鼠标移到画布上事件会被 iframe 吞掉）。

import { useRef } from 'react';
import { useTemplateStore } from '@/store/template-store';

export function Resizer({ side }: { side: 'left' | 'right' }) {
  const width = useTemplateStore((s) => (side === 'left' ? s.leftWidth : s.rightWidth));
  const setWidth = useTemplateStore((s) => (side === 'left' ? s.setLeftWidth : s.setRightWidth));
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    document.body.classList.add('wt-resizing');
    e.currentTarget.classList.add('wt-resizer--active');

    const handleMove = (ev: PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      const dx = ev.clientX - start.startX;
      // 左栏：向右拖变宽；右栏：向左拖变宽
      setWidth(start.startWidth + (side === 'left' ? dx : -dx));
    };
    const handleUp = () => {
      dragRef.current = null;
      document.body.classList.remove('wt-resizing');
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }

  return (
    <div
      className="wt-resizer"
      onPointerDown={handlePointerDown}
      title={side === 'left' ? '拖动调整左侧面板宽度' : '拖动调整右侧面板宽度'}
    />
  );
}
