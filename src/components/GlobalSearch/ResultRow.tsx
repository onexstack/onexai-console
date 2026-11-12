import type { ReactNode } from 'react';
import { Tag } from 'antd';

import type { SearchItem } from './types';

import styles from './styles.module.scss';

/** 只高亮标题里的第一处命中，避免长描述被切成碎片。 */
function mark(label: string, keyword: string): ReactNode {
  const q = keyword.trim();
  if (!q) return label;
  const index = label.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return label;
  return (
    <>
      {label.slice(0, index)}
      <span className={styles.mark}>{label.slice(index, index + q.length)}</span>
      {label.slice(index + q.length)}
    </>
  );
}

/**
 * 一条搜索结果。
 *
 * 顶栏下拉（`optionRender`）与 Wujie/移动端的模态面板共用同一份渲染，
 * 两处样式不会漂移。
 */
export default function ResultRow({ item, keyword }: { item: SearchItem; keyword: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.main}>
        <span className={styles.titleLine}>
          <span className={styles.title}>{mark(item.label, keyword)}</span>
          {item.hint && <span className={styles.hint}>{item.hint}</span>}
        </span>
        {item.description && <span className={styles.description}>{item.description}</span>}
      </span>
      <Tag className={styles.path} bordered={false}>
        {item.path}
      </Tag>
    </div>
  );
}
