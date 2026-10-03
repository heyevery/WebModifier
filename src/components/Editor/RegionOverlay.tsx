// src/components/Editor/RegionOverlay.tsx
// 高亮覆盖层：基于 iframe 广播的 rects 绘制每个可编辑区域的高亮框

import { motion } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';

export function RegionOverlay() {
  const regions = useTemplateStore((s) => s.regions);
  const rectsByRid = useTemplateStore((s) => s.rectsByRid);
  const selectedRid = useTemplateStore((s) => s.selectedRid);
  const setSelectedRid = useTemplateStore((s) => s.setSelectedRid);

  return (
    <>
      {regions.map((region) => {
        const rid = region.anchorRids[0];
        const rectInfo = rectsByRid[rid];
        if (!rectInfo) return null;
        const { rect } = rectInfo;
        const isSelected = selectedRid === rid;
        const labelInside = rect.top < 24;
        return (
          <motion.div
            key={rid}
            className={`wt-overlay-box ${isSelected ? 'wt-overlay-box--selected' : ''}`}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedRid(isSelected ? null : rid);
            }}
          >
            <span className={`wt-overlay-label ${labelInside ? 'wt-overlay-label--inside' : ''}`}>
              {region.label || region.id}
            </span>
          </motion.div>
        );
      })}
    </>
  );
}
