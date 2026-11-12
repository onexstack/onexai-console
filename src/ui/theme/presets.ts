/**
 * Ant Design 主题预设配置（light / dark / compact / darkCompact）
 */

import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import {
  defaultPrimaryColor,
  borderRadiusTokens,
  colorTokens,
  fontTokens,
  siderTokens,
} from './tokens';

/**
 * 左侧边栏菜单的主题令牌，对齐火山引擎 AgentKit 控制台。
 *
 * 只挂给 DefaultLayout 里的那个 Menu（`<ConfigProvider theme>` 局部生效），
 * 不进全局 `lightTheme` / `darkTheme`：那里的 Menu 令牌同样管着顶栏头像下拉、
 * 分页大小下拉这类弹出菜单，侧栏专属的 36px 行高和 8px 外边距会把它们一起改窄。
 *
 * 选中态刻意不用主色：参考图是「同色系深一档的圆角块 + 近黑加粗文字」，主色蓝
 * 只留给按钮和链接。
 */
export function createSiderMenuTheme(mode: 'light' | 'dark'): ThemeConfig {
  const sider = siderTokens[mode];

  return {
    components: {
      Menu: {
        // 菜单自身透明，露出 Sider / 抽屉的底色；展开的子菜单也不另铺底色，
        // 否则侧栏会出现一块比周围略深的矩形。
        itemBg: 'transparent',
        subMenuItemBg: 'transparent',

        itemColor: sider.text,
        itemHoverColor: sider.text,
        itemHoverBg: sider.itemHoverBg,
        itemSelectedColor: sider.text,
        itemSelectedBg: sider.itemSelectedBg,
        itemActiveBg: sider.itemActiveBg,
        // 子项被选中时父级标题的颜色：保持近黑（antd 默认会转成主色）。
        subMenuItemSelectedColor: sider.text,

        groupTitleColor: sider.groupText,
        groupTitleFontSize: 12,

        // 行高与间距对齐参考图：36px 行高 + 2px 上下间距 = 40px 节距。
        itemHeight: 36,
        itemMarginBlock: 2,
        itemMarginInline: 8,
        itemPaddingInline: 8,
        itemBorderRadius: 6,
        subMenuItemBorderRadius: 6,
        iconSize: 16,
        collapsedIconSize: 18,
        iconMarginInlineEnd: 10,
      },
    },
  };
}

export const lightTheme: ThemeConfig = {
  cssVar: { prefix: 'onex' },
  hashed: false,
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: defaultPrimaryColor,
    colorSuccess: colorTokens.success,
    colorWarning: colorTokens.warning,
    colorError: colorTokens.error,
    colorInfo: colorTokens.info,

    borderRadius: borderRadiusTokens.md,
    borderRadiusLG: borderRadiusTokens.lg,
    borderRadiusSM: borderRadiusTokens.sm,
    borderRadiusXS: borderRadiusTokens.xs,

    colorBgContainer: colorTokens.backgroundTertiary,
    colorBgLayout: colorTokens.background,
    colorBgElevated: colorTokens.backgroundTertiary,
    colorBgSpotlight: colorTokens.backgroundSecondary,

    colorText: colorTokens.textPrimary,
    colorTextSecondary: colorTokens.textSecondary,
    colorTextTertiary: colorTokens.textTertiary,
    colorTextQuaternary: colorTokens.textQuaternary,

    colorBorder: colorTokens.border,
    colorBorderSecondary: colorTokens.borderSecondary,

    fontSize: fontTokens.size.base,
    fontFamily: fontTokens.family,
    fontWeightStrong: fontTokens.weight.semibold,

    lineHeight: fontTokens.lineHeight.base,

    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
    boxShadowSecondary: '0 4px 16px rgba(0, 0, 0, 0.08)',

    motionDurationFast: '0.1s',
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.3s',
  },
  components: {
    Button: {
      // 只保留尺寸/圆角：按钮配色（含默认按钮底色、hover 色、阴影）走 antd
      // 默认值，与 onex-console 完全一致。
      borderRadius: 6,
      controlHeight: 32,
      controlHeightLG: 40,
      controlHeightSM: 24,
      // 火山引擎按钮的左右留白比 antd 默认更宽，按钮看起来更“饱满”。
      paddingInline: 16,
      paddingInlineLG: 24,
      paddingInlineSM: 8,
      // 参考图里的按钮文字是常规字重，不是粗体。
      fontWeight: fontTokens.weight.normal,
    },
    Card: {
      borderRadiusLG: borderRadiusTokens.lg,
      boxShadowTertiary: '0 2px 8px rgba(0, 0, 0, 0.06)',
    },
    Table: {
      borderRadius: borderRadiusTokens.md,
      rowHoverBg: '#FAFAFA',
    },
    Input: {
      borderRadius: borderRadiusTokens.sm,
    },
    Select: {
      borderRadius: borderRadiusTokens.sm,
    },
    Pagination: {
      // 页码按钮 32×32、圆角 6。itemSize 必须显式写：它默认取 controlHeight，
      // 而 compact 算法会把 controlHeight 压到 24，页码会跟着缩水。
      itemSize: 32,
      itemSizeSM: 32,
      borderRadius: 6,
      // 当前页做成主色实心（antd 默认是「白底 + 主色描边 + 主色文字」）。
      // 走组件 token 而不是 SCSS 覆盖：antd 生成的选择器是
      // `.ant-pagination .ant-pagination-item-active`，单类覆盖会被它压过；
      // 而且 token 同时命中 ListPagination 底栏与 antd Table 内置分页，
      // 两处观感因此一致。悬停的链接色也要一并给，否则悬停会掉回浅主色。
      itemActiveBg: defaultPrimaryColor,
      itemActiveColor: '#fff',
      itemActiveColorHover: '#fff',
    },
    Modal: {
      borderRadiusLG: borderRadiusTokens.lg,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
    },
    Drawer: {
      borderRadiusLG: borderRadiusTokens.lg,
    },
    Tooltip: {
      borderRadius: borderRadiusTokens.sm,
      colorBgSpotlight: 'rgba(0, 0, 0, 0.85)',
      colorTextLightSolid: '#fff',
    },
    Menu: {
      borderRadius: borderRadiusTokens.sm,
      itemBorderRadius: borderRadiusTokens.sm,
    },
    Segmented: {
      // 选中项与左侧栏 Menu 的选中项同底色：antd light 算法的 colorPrimaryBg。
      // 默认值 colorBgElevated 在这里是白色，与 #f5f5f5 的轨道几乎无差别。
      itemSelectedBg: '#e6f4ff',
    },
  },
};

export const darkTheme: ThemeConfig = {
  cssVar: { prefix: 'onex' },
  hashed: false,
  algorithm: theme.darkAlgorithm,
  token: {
    ...lightTheme.token,
    colorBgContainer: colorTokens.darkBackgroundSecondary,
    colorBgLayout: colorTokens.darkBackground,
    colorBgElevated: colorTokens.darkBackgroundTertiary,
    colorBgSpotlight: colorTokens.darkBackgroundSecondary,

    colorText: colorTokens.darkTextPrimary,
    colorTextSecondary: colorTokens.darkTextSecondary,
    colorTextTertiary: colorTokens.darkTextTertiary,

    colorBorder: 'rgba(255, 255, 255, 0.12)',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.06)',

    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
    boxShadowSecondary: '0 4px 16px rgba(0, 0, 0, 0.45)',
  },
  components: {
    ...lightTheme.components,
    Table: {
      ...lightTheme.components?.Table,
      rowHoverBg: 'rgba(255, 255, 255, 0.03)',
    },
    Tooltip: {
      ...lightTheme.components?.Tooltip,
      colorBgSpotlight: 'rgba(255, 255, 255, 0.85)',
      colorTextLightSolid: 'rgba(0, 0, 0, 0.88)',
    },
    Segmented: {
      // 暗色下左侧栏（Menu 默认 light 变体 + dark 算法）的选中底色是
      // colorPrimaryBg = #15325b。不要用 tokens.scss 的 --color-primary-bg
      // (#111a2c)：那是给自定义样式用的，antd Menu 读的不是它。
      itemSelectedBg: '#15325b',
    },
  },
};

export const compactTheme: ThemeConfig = {
  cssVar: { prefix: 'onex' },
  hashed: false,
  algorithm: [theme.defaultAlgorithm, theme.compactAlgorithm],
  token: lightTheme.token,
  components: {
    ...lightTheme.components,
    Button: {
      ...lightTheme.components?.Button,
      controlHeight: 24,
      controlHeightLG: 32,
      controlHeightSM: 20,
    },
  },
};

export const darkCompactTheme: ThemeConfig = {
  cssVar: { prefix: 'onex' },
  hashed: false,
  algorithm: [theme.darkAlgorithm, theme.compactAlgorithm],
  token: darkTheme.token,
  components: {
    ...darkTheme.components,
    Button: {
      ...darkTheme.components?.Button,
      controlHeight: 24,
      controlHeightLG: 32,
      controlHeightSM: 20,
    },
  },
};
