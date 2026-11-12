import type { ReactNode } from 'react';
import clsx from 'clsx';

import styles from './styles.module.scss';

/**
 * 白底整页容器：给「页头 + 内容片段」的页面一个统一根节点。
 *
 * 根节点带 `data-page-surface="flush"`，`DefaultLayout` 据此去掉内容区的灰底与
 * 内边距，由这里自己铺白底并留出 `--page-gutter`。页头（`PageHeader`）传
 * `inset={false}`，两边的左边缘天然对齐。
 *
 * 自己没有标题、也不外包整页外壳的页面（如命令台、命令覆盖）用它；已经带
 * `PageLayout` / `DetailShell` / `ResourceShell` 的页面不需要它。
 */
export interface PageSurfaceProps {
  children?: ReactNode;
  className?: string;
}

export default function PageSurface({ children, className }: PageSurfaceProps) {
  return (
    <div className={clsx(styles.surface, className)} data-page-surface="flush">
      {children}
    </div>
  );
}
