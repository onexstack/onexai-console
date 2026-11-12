import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { AutoComplete } from 'antd';
import type { DefaultOptionType, RefSelectProps } from 'antd/es/select';
import { SearchOutlined } from '@ant-design/icons';

import { useTranslation } from '@/runtime';

import ResultRow from './ResultRow';
import { QUICK_JUMP_EVENT, type SearchItem, type SearchOptionData } from './types';
import { useSearchGroups } from './useSearchGroups';

import styles from './styles.module.scss';

/**
 * 顶栏全局搜索。
 *
 * 输入框本身就是搜索入口：聚焦展开「动作 + 页面」，输入后再并发读取各类资源
 * 并分组展示。↑↓ 由 rc-select 负责，Enter 打开、Esc 关闭、⌘K 聚焦。
 *
 * 需要关键字时才请求资源（见 `useSearchGroups`），聚焦不会产生任何接口调用。
 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const inputRef = useRef<RefSelectProps>(null);
  const [keyword, setKeyword] = useState('');
  const [open, setOpen] = useState(false);
  const { groups, loading, namespace } = useSearchGroups(keyword);

  const itemByValue = useMemo(() => {
    const map = new Map<string, SearchItem>();
    for (const group of groups) {
      for (const item of group.items) map.set(item.key, item);
    }
    return map;
  }, [groups]);

  // option 的 label 保持字符串（combobox 回填与无障碍都依赖它），富文本行走
  // `optionRender`；`value` 用全局唯一 key，跨分组不会撞。
  const options = useMemo<DefaultOptionType[]>(
    () =>
      groups.map(group => ({
        label: group.label,
        options: group.items.map<SearchOptionData>(item => ({
          value: item.key,
          label: item.label,
          searchItem: item,
        })),
      })),
    [groups]
  );

  const go = useCallback(
    (value: string, option?: DefaultOptionType) => {
      const item = (option as SearchOptionData | undefined)?.searchItem ?? itemByValue.get(value);
      if (!item) return;
      setOpen(false);
      setKeyword('');
      inputRef.current?.blur();
      navigate(item.path);
    },
    [itemByValue, navigate]
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    const onOpen = () => {
      setOpen(true);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(QUICK_JUMP_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(QUICK_JUMP_EVENT, onOpen);
    };
  }, []);

  // 输入法确认候选词的 Enter 不能当成「打开当前结果」。Select 本身没有
  // keydown 入口，挂在包裹层上（display: contents 不产生布局盒）。
  const guardCompositionEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return;
    const native = event.nativeEvent;
    if (native.isComposing || native.keyCode === 229) {
      event.stopPropagation();
    }
  };

  return (
    <div className={styles.wrapper} onKeyDownCapture={guardCompositionEnter}>
      <AutoComplete
        ref={inputRef}
        className={styles.search}
        value={keyword}
        options={options}
        open={open}
        onOpenChange={setOpen}
        onChange={value => {
          setKeyword(String(value ?? ''));
          setOpen(true);
        }}
        onSelect={go}
        // 过滤与排序都在 useSearchGroups 里做；开着 rc-select 的过滤会按内部
        // value（`row:agents:foo`）再筛一次，带关键字时结果会被清空。
        filterOption={false}
        // combobox 默认不激活第一项，Enter 会「没反应」。
        defaultActiveFirstOption
        // 结果最多几十条且行高自定义：关掉虚拟滚动，避免高度估算抖动。
        virtual={false}
        listHeight={380}
        // 固定宽度：弹层不从输入框撑开，按 CSS 里的 460px 展示。
        popupMatchSelectWidth={false}
        allowClear
        prefix={<SearchOutlined />}
        suffix={<kbd className={styles.kbd}>⌘K</kbd>}
        placeholder={t('搜索页面、资源或动作…')}
        notFoundContent={loading ? t('正在搜索资源…') : t('没有匹配项')}
        optionRender={option => (
          <ResultRow item={(option.data as SearchOptionData).searchItem} keyword={keyword} />
        )}
        popupRender={menu => (
          <div className={styles.panel}>
            {menu}
            <div className={styles.footer}>
              <span>{t('↑↓ 选择')}</span>
              <span>{t('Enter 打开')}</span>
              <span>{t('Esc 关闭')}</span>
              <span className={styles.footerMuted}>
                {loading ? t('正在搜索资源…') : namespace ? `${t('仅搜索空间')} ${namespace}` : ''}
              </span>
            </div>
          </div>
        )}
        classNames={{
          popup: { root: styles.popup, list: styles.list, listItem: styles.listItem },
        }}
      />
    </div>
  );
}
