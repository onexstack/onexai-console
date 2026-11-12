import { useEffect, useMemo, useRef, useState, type ComponentRef, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Input, Modal } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import clsx from 'clsx';

import { useTranslation } from '@/runtime';

import ResultRow from './ResultRow';
import { QUICK_JUMP_EVENT, type SearchItem } from './types';
import { useSearchGroups } from './useSearchGroups';

import styles from './styles.module.scss';

/**
 * 模态版全局搜索。
 *
 * 只在没有顶栏搜索框的场景挂载：Wujie 嵌入（子应用不画 Header）、`showHeader`
 * 关闭、以及 `< lg` 的窄屏。桌面独立运行时用的是顶栏里的 `GlobalSearch`。
 *
 * 数据与行渲染完全复用同一套（`useSearchGroups` + `ResultRow`），只是把
 * 「下拉」换成「居中面板」，并自己接管 ↑↓/Enter。
 */
export default function GlobalSearchModal() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const inputRef = useRef<ComponentRef<typeof Input>>(null);
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState(0);
  const { groups, loading, namespace } = useSearchGroups(keyword);

  const flat = useMemo(() => groups.flatMap(group => group.items), [groups]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(QUICK_JUMP_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(QUICK_JUMP_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setKeyword('');
    setActive(0);
  }, [open]);

  // 结果随关键字变化后，active 可能越界；收敛回最后一行而不是归零。
  useEffect(() => {
    setActive(current => Math.min(current, Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  const go = (item: SearchItem | undefined) => {
    if (!item) return;
    setOpen(false);
    navigate(item.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(index => Math.min(index + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(flat[active]);
    }
  };

  // 分组渲染时需要一个连续索引来对应 ↑↓ 的位置。
  let index = 0;

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      width={640}
      title={null}
      closable={false}
      destroyOnHidden
      afterOpenChange={visible => {
        if (visible) inputRef.current?.focus();
      }}
      styles={{ body: { padding: 0 } }}
    >
      <div className={styles.modalHeader}>
        <Input
          ref={inputRef}
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          onKeyDown={onKeyDown}
          prefix={<SearchOutlined className={styles.modalSearchIcon} />}
          placeholder={t('搜索页面、资源或动作…')}
          variant="borderless"
          size="large"
          allowClear
        />
      </div>

      <div className={styles.modalResults}>
        {groups.length === 0 ? (
          <div className={styles.modalEmpty}>{loading ? t('正在搜索资源…') : t('没有匹配项')}</div>
        ) : (
          groups.map(group => (
            <div key={group.key}>
              <div className={styles.modalGroup}>{group.label}</div>
              {group.items.map(item => {
                const current = index++;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onMouseEnter={() => setActive(current)}
                    onClick={() => go(item)}
                    className={clsx(styles.modalItem, current === active && styles.modalItemActive)}
                  >
                    <ResultRow item={item} keyword={keyword} />
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className={styles.footer}>
        <span>{t('↑↓ 选择')}</span>
        <span>{t('Enter 打开')}</span>
        <span>{t('Esc 关闭')}</span>
        <span className={styles.footerMuted}>
          {loading ? t('正在搜索资源…') : namespace ? `${t('仅搜索空间')} ${namespace}` : ''}
        </span>
      </div>
    </Modal>
  );
}
