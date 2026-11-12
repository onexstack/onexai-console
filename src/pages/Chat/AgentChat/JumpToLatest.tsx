import { ArrowDownOutlined } from '@ant-design/icons';

import styles from './styles.module.scss';

export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.jumpToLatest}
      onClick={onClick}
      aria-label="回到最新"
      title="回到最新"
    >
      <ArrowDownOutlined />
    </button>
  );
}
