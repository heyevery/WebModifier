/** @type {import('tailwindcss').Config} */
// 颜色全部取自 src/index.css 的设计令牌（RGB 通道三元组），
// 通过 <alpha-value> 保持 bg-wt-primary/15 这类透明度修饰符可用。
const v = (name) => `rgb(var(--wt-${name}-rgb) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx,html}', './electron/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 基础表面
        'wt-bg': v('bg'),
        'wt-surface': v('surface'),
        'wt-surface-2': v('surface-2'),
        'wt-input': v('input'),
        // VSCode 骨架
        'wt-titlebar': v('titlebar'),
        'wt-activitybar': v('activitybar'),
        'wt-sidebar': v('sidebar'),
        'wt-tabbar': v('tabbar'),
        'wt-tab-inactive': v('tab-inactive'),
        'wt-tab-active': v('tab-active'),
        'wt-statusbar': v('statusbar'),
        // 边框 / 文本
        'wt-border': v('border'),
        'wt-border-strong': v('border-strong'),
        'wt-text': v('text'),
        'wt-text-bright': v('text-bright'),
        'wt-muted': v('muted'),
        // 强调
        'wt-primary': v('primary'),
        'wt-primary-hover': v('primary-hover'),
        'wt-accent': v('accent'),
        'wt-focus': v('focus'),
        'wt-selection': v('selection'),
        'wt-list-hover': v('list-hover'),
        // 语义
        'wt-success': v('success'),
        'wt-warning': v('warning'),
        'wt-danger': v('danger')
      },
      fontFamily: {
        sans: ['var(--wt-font-sans)'],
        mono: ['var(--wt-font-mono)']
      },
      borderRadius: {
        DEFAULT: 'var(--wt-radius)',
        sm: 'var(--wt-radius-sm)',
        md: 'var(--wt-radius)',
        lg: 'var(--wt-radius-lg)'
      },
      boxShadow: {
        'wt-sm': '0 1px 2px rgba(0,0,0,0.4)',
        'wt-md': '0 4px 12px rgba(0,0,0,0.5)',
        'wt-lg': '0 12px 28px rgba(0,0,0,0.55)'
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-up': 'slideUp 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-soft': 'pulseSoft 1.4s ease-in-out infinite'
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        pulseSoft: { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.5 } }
      }
    }
  },
  plugins: []
};
