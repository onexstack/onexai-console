import { useState } from 'react';
import { BulbOutlined, DownOutlined, LoadingOutlined } from '@ant-design/icons';

import styles from './bubble.module.scss';

/**
 * 思考过程。
 *
 * `manualOpen` 为 null 时跟随 `thinking`：流式期间自动展开，正文开始后自动收起；
 * 用户一旦点过，就完全交给用户，不再被自动收起打断阅读。
 */
export function ReasoningBlock({ reasoning, thinking }: { reasoning: string; thinking: boolean }) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? thinking;

  return (
    <div className={styles.reasoning}>
      <button
        type="button"
        className={styles.reasoningHead}
        onClick={() => setManualOpen(!open)}
        aria-expanded={open}
      >
        {thinking ? <LoadingOutlined /> : <BulbOutlined />}
        <span>{thinking ? '思考中' : '已深度思考'}</span>
        <DownOutlined
          className={`${styles.reasoningChevron} ${open ? '' : styles.reasoningChevronClosed}`}
        />
      </button>
      {open && <div className={styles.reasoningBody}>{reasoning}</div>}
    </div>
  );
}
