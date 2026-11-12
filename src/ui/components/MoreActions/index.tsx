import { Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';

import styles from './styles.module.scss';

export interface MoreActionsProps {
  /** 菜单项。未传或空数组时按钮渲染为禁用态。 */
  items?: MenuProps['items'];
  /** 菜单点击回调；菜单项也可以各自带 `onClick`。 */
  onClick?: MenuProps['onClick'];
  /**
   * 翻译函数，缺省原样返回 key（与 `ResourcePage` 的 `t` prop 同一约定：
   * `src/ui` 刻意不依赖 react-i18next / react-router）。
   */
  t?: (key: string) => string;
}

const identity = (key: string) => key;

/**
 * 列表页操作列末位的标准「更多」入口。
 *
 * # 为什么空菜单也要渲染
 *
 * 操作列是一个纵向对齐的表格列：某一行的动作数量变化时，若按钮随消失/出现，
 * 行与行之间就会错位，用户也会以为「这行没有操作」。所以触发器**每一行都渲染**，
 * 只是没有菜单项时置灰（悬停说明「暂无更多操作」），而不是隐藏或弹出空面板。
 *
 * # 为什么是 `<button>` 而不是 `<span>`
 *
 * 旧实现是 `<span>`，不可聚焦、键盘不可达。这里用原生 button 重置样式，
 * 保留与链接文字一致的外观，同时获得焦点环与 Enter/Space 激活。
 */
export default function MoreActions({ items, onClick, t = identity }: MoreActionsProps) {
  const label = (
    <>
      {t('更多')} <DownOutlined className={styles.caret} />
    </>
  );

  // `items` 里允许出现 `null`（条件项），只有真正渲染出一项才算「有更多」，
  // 否则会弹出一个空面板。
  if (!items?.some(Boolean)) {
    return (
      // 禁用按钮不触发鼠标事件，Tooltip 必须包在外层 span 上（antd 的推荐写法）。
      <Tooltip title={t('暂无更多操作')}>
        <span className={styles.disabledWrap}>
          <button type="button" className={styles.moreLinkDisabled} aria-disabled="true" disabled>
            {label}
          </button>
        </span>
      </Tooltip>
    );
  }

  return (
    <Dropdown menu={{ items, onClick }} trigger={['click']} placement="bottomRight">
      <button type="button" className={styles.moreLink}>
        {label}
      </button>
    </Dropdown>
  );
}
