/**
 * Design Tokens — onex-console 设计系统基础变量
 */

/** 主色对齐 onex-console。按钮、链接、聚焦态都由它派生。 */
export const defaultPrimaryColor = '#1677FF';

export const colorTokens = {
  success: '#52C41A',
  warning: '#FAAD14',
  error: '#FF4D4F',
  info: '#1677FF',

  textPrimary: 'rgba(0, 0, 0, 0.88)',
  textSecondary: 'rgba(0, 0, 0, 0.65)',
  textTertiary: 'rgba(0, 0, 0, 0.45)',
  textQuaternary: 'rgba(0, 0, 0, 0.25)',

  border: '#D9D9D9',
  borderSecondary: '#F0F0F0',

  background: '#F5F5F5',
  backgroundSecondary: '#FAFAFA',
  backgroundTertiary: '#FFFFFF',

  darkTextPrimary: 'rgba(255, 255, 255, 0.85)',
  darkTextSecondary: 'rgba(255, 255, 255, 0.65)',
  darkTextTertiary: 'rgba(255, 255, 255, 0.45)',

  darkBackground: '#141414',
  darkBackgroundSecondary: '#1D1D1D',
  darkBackgroundTertiary: '#262626',
};

/**
 * 左侧边栏色板，对齐火山引擎 AgentKit 控制台。
 *
 * 与 `src/ui/styles/tokens.scss` 的 `--color-sider-*` 是同一套值：SCSS 那份给
 * Sider / 移动端抽屉的底色用，这里给 antd Menu 组件令牌用（见
 * `presets.ts` 的 `createSiderMenuTheme`）。改一处必须同步另一处。
 */
export const siderTokens = {
  light: {
    bg: '#F6F6FB',
    text: '#0C0D0E',
    groupText: '#7A7880',
    itemHoverBg: '#F0F0F6',
    itemActiveBg: '#EBEBF5',
    itemSelectedBg: '#EBEBF5',
  },
  dark: {
    bg: '#17171C',
    text: 'rgba(255, 255, 255, 0.88)',
    groupText: 'rgba(255, 255, 255, 0.45)',
    itemHoverBg: '#202027',
    itemActiveBg: '#2B2B34',
    itemSelectedBg: '#26262E',
  },
} as const;

export const borderRadiusTokens = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 20,
};

export const shadowTokens = {
  xs: '0 1px 4px rgba(0, 0, 0, 0.04)',
  sm: '0 2px 8px rgba(0, 0, 0, 0.06)',
  md: '0 4px 16px rgba(0, 0, 0, 0.08)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.12)',
  xl: '0 12px 32px rgba(0, 0, 0, 0.16)',
};

export const gradientTokens = {
  primary: 'linear-gradient(135deg, #1677FF 0%, #4096FF 100%)',
  success: 'linear-gradient(135deg, #52C41A 0%, #73D13D 100%)',
  warning: 'linear-gradient(135deg, #FAAD14 0%, #FFC53D 100%)',
  error: 'linear-gradient(135deg, #FF4D4F 0%, #FF7875 100%)',
  sunset: 'linear-gradient(135deg, #FF6B35 0%, #F7931E 50%, #FDC830 100%)',
  ocean: 'linear-gradient(135deg, #1677FF 0%, #36CFC9 100%)',
};

export const spacingTokens = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const fontTokens = {
  /**
   * 与火山引擎控制台同源的字体栈：macOS 走 SF Pro + 苹方，Windows 走 Segoe UI +
   * 微软雅黑。中文族名必须写在 Roboto / Helvetica 之前——那两者都没有中文字形，
   * 写在后面等于跳过，最后由系统兜底的字体在 Windows 上会变成宋体，和参考图对不上。
   *
   * 与 `src/styles/index.scss` 的 `body` 字体栈必须保持一致。
   */
  family:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  size: {
    xs: 12,
    sm: 13,
    base: 14,
    lg: 16,
    xl: 20,
  },
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    base: 1.5,
    relaxed: 1.75,
  },
};

export const animationTokens = {
  duration: {
    fast: '0.1s',
    base: '0.2s',
    slow: '0.3s',
  },
  easing: {
    easeInOut: 'ease-in-out',
    smooth: 'cubic-bezier(0.645, 0.045, 0.355, 1)',
  },
};

/** 9 种预设主题色 */
export const presetColors = {
  techBlue: '#1677FF',
  vibrantOrange: '#FF6B35',
  freshGreen: '#52C41A',
  vibrantPurple: '#9254DE',
  vibrantRed: '#FF4D4F',
  youthfulPink: '#EB2F96',
  deepCyan: '#13C2C2',
  sunnyYellow: '#FAAD14',
  ocean: '#36CFC9',
};
