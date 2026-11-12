/**
 * 主题工具函数 — createThemeConfig
 */

import type { ThemeConfig } from 'antd';
import { lightTheme, darkTheme, compactTheme, darkCompactTheme } from './presets';

export interface ThemeOptions {
  /** 主题模式，默认 'light' */
  mode?: 'light' | 'dark';
  /** 是否启用紧凑模式，默认 false */
  compact?: boolean;
  /** 自定义主题色 */
  primaryColor?: string;
  /** 自定义成功色 */
  successColor?: string;
  /** 自定义警告色 */
  warningColor?: string;
  /** 自定义错误色 */
  errorColor?: string;
  /** 自定义圆角大小 */
  borderRadius?: number;
  /**
   * 按钮圆角。不设置时跟随 `borderRadius`。
   *
   * 按钮单独一个旋钮，是因为不同设计体系对按钮和输入框的圆角要求不同
   * （火山引擎两者一致，腾讯云按钮更方）；全局圆角不变也能单独调按钮。
   */
  buttonBorderRadius?: number;
  /** 自定义字体大小 */
  fontSize?: number;
}

function getRadiusScale(borderRadius: number) {
  return {
    borderRadius,
    borderRadiusLG: borderRadius === 0 ? 0 : borderRadius + 4,
    borderRadiusSM: borderRadius === 0 ? 0 : Math.max(borderRadius - 4, 2),
    borderRadiusXS: borderRadius === 0 ? 0 : Math.max(borderRadius - 6, 2),
  };
}

function resolveBaseTheme(mode: 'light' | 'dark', compact: boolean): ThemeConfig {
  if (mode === 'dark' && compact) return darkCompactTheme;
  if (mode === 'dark') return darkTheme;
  if (compact) return compactTheme;
  return lightTheme;
}

/**
 * 创建 Ant Design 主题配置
 *
 * @example
 * ```tsx
 * // 暗色主题
 * <ConfigProvider theme={createThemeConfig({ mode: 'dark' })}>
 *
 * // 自定义主题色
 * <ConfigProvider theme={createThemeConfig({ primaryColor: '#13C2C2' })}>
 * ```
 */
export function createThemeConfig(options: ThemeOptions = {}): ThemeConfig {
  const {
    mode = 'light',
    compact = false,
    primaryColor,
    successColor,
    warningColor,
    errorColor,
    borderRadius,
    buttonBorderRadius,
    fontSize,
  } = options;

  const baseTheme = resolveBaseTheme(mode, compact);
  const hasOverrides = Boolean(
    primaryColor ||
    successColor ||
    warningColor ||
    errorColor ||
    borderRadius !== undefined ||
    buttonBorderRadius !== undefined ||
    fontSize !== undefined
  );

  if (!hasOverrides) return baseTheme;

  const radiusScale = borderRadius !== undefined ? getRadiusScale(borderRadius) : undefined;
  // 按钮圆角优先取自己的旋钮；没有时才跟随全局圆角。
  const buttonRadius = buttonBorderRadius ?? radiusScale?.borderRadius;

  return {
    ...baseTheme,
    token: {
      ...baseTheme.token,
      ...(primaryColor && { colorPrimary: primaryColor }),
      ...(successColor && { colorSuccess: successColor }),
      ...(warningColor && { colorWarning: warningColor }),
      ...(errorColor && { colorError: errorColor }),
      ...(radiusScale ?? {}),
      ...(fontSize !== undefined && { fontSize }),
    },
    ...(radiusScale || buttonRadius !== undefined
      ? {
          components: {
            ...baseTheme.components,
            ...(buttonRadius !== undefined
              ? { Button: { ...baseTheme.components?.Button, borderRadius: buttonRadius } }
              : {}),
            ...(radiusScale
              ? {
                  Card: {
                    ...baseTheme.components?.Card,
                    borderRadiusLG: radiusScale.borderRadiusLG,
                  },
                  Input: { ...baseTheme.components?.Input, borderRadius: radiusScale.borderRadius },
                  Select: {
                    ...baseTheme.components?.Select,
                    borderRadius: radiusScale.borderRadius,
                  },
                  Modal: {
                    ...baseTheme.components?.Modal,
                    borderRadiusLG: radiusScale.borderRadiusLG,
                  },
                  Drawer: {
                    ...baseTheme.components?.Drawer,
                    borderRadiusLG: radiusScale.borderRadiusLG,
                  },
                  Menu: {
                    ...baseTheme.components?.Menu,
                    borderRadius: radiusScale.borderRadius,
                    itemBorderRadius: radiusScale.borderRadius,
                  },
                  Tooltip: {
                    ...baseTheme.components?.Tooltip,
                    borderRadius: radiusScale.borderRadius,
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

/** 判断颜色是否为深色 */
export function isDarkColor(color: string): boolean {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

/** 获取对比色（黑色或白色） */
export function getContrastColor(backgroundColor: string): string {
  return isDarkColor(backgroundColor) ? '#FFFFFF' : '#000000';
}
