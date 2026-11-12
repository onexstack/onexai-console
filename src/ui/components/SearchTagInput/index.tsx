import { useEffect, useMemo, useRef, useState } from 'react';
import { Tag } from 'antd';

import styles from './styles.module.scss';

/**
 * 资源列表的标准搜索栏：回车把输入打成字段筛选标签，左端漏斗图标可切换字段。
 *
 * 原为 `ResourcePage` 的内部组件；`/agents` 这类自绘列表也使用同一套搜索控件，
 * 因此抽成独立组件。行为（输入法组字、同字段替换、Esc 分层清理）与抽取前一致。
 */

/** 缺省翻译器：调用方没有 i18n 时，中文 key 直接作为界面文案。 */
const identityT = (key: string): string => key;

// ─────────────────────── FilterSearchIcon ───────────────────────────────────

function FilterSearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <path
        d="M1 2h9M1 5.5h6M1 9h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="10.5" cy="10.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M12.5 12.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────── SearchTagInput ─────────────────────────────────────

export interface SearchTag {
  fieldKey: string;
  fieldLabel: string;
  value: string;
}

export interface SearchTagInputProps {
  tags: SearchTag[];
  fields: { key: string; label: string }[];
  /**
   * 不选字段、直接输入回车时**补上的**字段（见 `ResourceDescriptor.defaultSearchField`）。
   *
   * 它只决定「回车提交到哪个字段」，**不参与任何显示**：输入框前不画 `名称:`，
   * placeholder/候选列表也按「还没选字段」来。缺省 `null`：回车必须先选一个字段。
   */
  defaultField?: { key: string; label: string } | null;
  onTagsChange: (tags: SearchTag[]) => void;
  /** 缺省恒等：没有 i18n 的页面直接用中文 key 作为界面文案。 */
  t?: (key: string) => string;
}

export function SearchTagInput({
  tags,
  fields,
  defaultField = null,
  onTagsChange,
  t = identityT,
}: SearchTagInputProps) {
  const [open, setOpen] = useState(false);
  const [pendingField, setPendingField] = useState<{ key: string; label: string } | null>(null);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** 输入法是否正在组字（`isComposing` 在部分浏览器/输入法下不可靠，自己再记一份）。 */
  const composingRef = useRef(false);
  /** 组字中的那一下回车：等输入法上屏完成后再提交搜索。见 `onCompositionEnd`。 */
  const submitAfterCompositionRef = useRef(false);

  /**
   * 回车提交时落到哪个字段：显式在下拉里选过的优先，否则补上描述符声明的默认字段。
   *
   * 默认字段**只影响提交到哪**，不参与显示 —— 见 `displayField`。两者都没有时
   * 回车什么也不做（旧行为）。
   */
  const commitField = pendingField ?? defaultField;

  /**
   * 输入框前画谁：只有运营显式选过字段时才画。
   *
   * 默认字段不常驻：空框里挂一个 `名称:` 看起来像一条删不掉的筛选条件（key 有了、
   * value 空着）。删掉 `名称: xxx` 标签后它还会再冒出来，于是「按名称的 key 删不掉」
   * —— 实际请求早就不带 `name` 了，只是界面在说谎。
   */
  const displayField = pendingField;

  /** 只有一个搜索字段时没有「切换」这回事：下拉与左侧图标按钮都不出现。 */
  const canSwitchField = fields.length > 1;

  /**
   * 下拉候选 = 还没被打成标签、且不是当前显式选中的字段。
   *
   * 默认字段**在候选里**：它不再画在输入框前，下拉是显式选它的唯一入口。已打标签
   * 的字段不列 —— 同字段再提交是替换，不是新增。
   */
  const availableFields = useMemo(
    () =>
      fields.filter(f => f.key !== pendingField?.key && !tags.some(tag => tag.fieldKey === f.key)),
    [fields, pendingField, tags]
  );

  const selectField = (field: { key: string; label: string }) => {
    setPendingField(field);
    setOpen(false);
    // **不清空已输入的内容**：先敲了关键字、再发现该按 ID 搜，是最常见的路径；
    // 清掉等于让人重打一遍。
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  /**
   * 把这次输入收成一个筛选标签。
   *
   * `rawValue` 只在「输入法上屏后提交」那条路径上传：那一刻 React 的 `inputVal`
   * 可能还是组字前的内容（`compositionend` 与 `input` 事件的先后因浏览器而异），
   * 所以那边直接读 DOM 上的最终值传进来。
   */
  const commitTag = (rawValue?: string) => {
    const value = (rawValue ?? inputVal).trim();
    if (!commitField || !value) return;

    const next: SearchTag = {
      fieldKey: commitField.key,
      fieldLabel: commitField.label,
      value,
    };
    // 同一字段**只留一个标签**：`api.list` 收到的 search 是按字段建的对象，
    // 重复标签里只有最后一个会生效，界面上却画着两条 —— 一个会说谎的界面。
    const at = tags.findIndex(tag => tag.fieldKey === commitField.key);
    onTagsChange(at === -1 ? [...tags, next] : tags.map((tag, i) => (i === at ? next : tag)));

    setPendingField(null);
    setInputVal('');
    setOpen(false);
  };

  const removeTag = (idx: number) => {
    onTagsChange(tags.filter((_, i) => i !== idx));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // 组字（中文输入法）中的回车先交给输入法上屏：这一下按的是「把拼音/字母
      // 落进输入框」，不是「搜索」。但**不能就此丢掉这次回车**——否则运营要按两次
      // 才搜得动（第一次只上屏，输入框里留着 `onex`，表格纹丝不动，看起来像
      // 「回车根本不过滤」）。这里记一笔，等 `compositionend` 上屏完成后提交。
      if (e.nativeEvent.isComposing || composingRef.current) {
        submitAfterCompositionRef.current = true;
        return;
      }
      e.preventDefault();
      commitTag();
    } else if (e.key === 'Escape') {
      // 组字中按 Esc 是取消这次组字，不应该在组字结束时补一次搜索。
      submitAfterCompositionRef.current = false;
      // 先收下拉：往下才是取消字段选择、清空输入。把清字放在最前面的话，
      // 「有文字 + 下拉开着」时按 Esc 会把正在改的关键字抹掉。
      if (open) {
        setOpen(false);
      } else if (pendingField) {
        setPendingField(null);
        setInputVal('');
      } else if (inputVal) {
        setInputVal('');
      }
    } else if (e.key === 'Backspace' && !inputVal && !pendingField && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /**
   * 空输入框被点/聚焦时打开字段下拉。
   *
   * 默认字段不再画在输入框前，下拉是显式选它的唯一入口，所以候选里包含默认字段。
   * 输入框已有文字时不自动弹：下拉会盖住正在看的内容。此时要换字段走左侧图标按钮
   * （它不影响已输入的文字，见 `selectField`）。
   */
  const tryOpenDropdown = () => {
    if (!canSwitchField || inputVal) return;
    if (availableFields.length > 0) setOpen(true);
  };

  return (
    <div
      className={styles.searchBox}
      ref={containerRef}
      onClick={() => {
        inputRef.current?.focus();
        tryOpenDropdown();
      }}
    >
      {canSwitchField ? (
        <button
          type="button"
          className={`${styles.searchBoxIcon} ${styles.searchBoxIconButton}`}
          title={t('切换搜索字段')}
          aria-label={t('切换搜索字段')}
          aria-expanded={open}
          // 保住输入框焦点：点图标不该把正在输入的输入框弄失焦（中文输入法组字
          // 途中失焦还会让上屏结果丢掉）。
          onMouseDown={e => e.preventDefault()}
          onClick={e => {
            // 不冒泡到外层容器的 onClick —— 那里还会再跑一遍聚焦 + 打开下拉。
            e.stopPropagation();
            // **不 toggle**：空框聚焦本来就会打开下拉，toggle 会把它立刻关掉。
            // 收起交给 Esc / 点外部。
            setOpen(true);
            inputRef.current?.focus();
          }}
        >
          <FilterSearchIcon />
        </button>
      ) : (
        <span className={styles.searchBoxIcon} aria-hidden="true">
          <FilterSearchIcon />
        </span>
      )}
      <div className={styles.searchBoxContent}>
        {tags.map((tag, idx) => (
          <Tag
            key={`${tag.fieldKey}-${idx}`}
            closable
            onClose={e => {
              e.stopPropagation();
              removeTag(idx);
            }}
            className={styles.searchTag}
          >
            {tag.fieldLabel}: {tag.value}
          </Tag>
        ))}
        <span className={styles.searchInputWrapper}>
          {displayField && (
            <button
              type="button"
              className={styles.pendingFieldLabel}
              // 前缀只在**显式选过字段**时出现，此时它就是「换一个字段」的入口。
              title={t('切换搜索字段')}
              aria-label={`${displayField.label}: ${t('切换搜索字段')}`}
              onMouseDown={e => e.preventDefault()}
              onClick={e => {
                e.stopPropagation();
                setOpen(prev => !prev);
              }}
            >
              {displayField.label}:&nbsp;
            </button>
          )}
          <input
            ref={inputRef}
            className={styles.searchInputNative}
            value={inputVal}
            aria-label={displayField ? displayField.label : t('搜索过滤条件')}
            placeholder={
              tags.length === 0
                ? displayField
                  ? t('输入后按回车搜索')
                  : // 还没选字段时**不提示具体字段名**：回车会补成描述符声明的默认
                    // 字段（这几页是「名称」），但那是提交时的行为，不该画在框里。
                    t('多个关键字只支持精准查询，用竖线"|"分隔，多个过滤标签用回车键分隔')
                : ''
            }
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={tryOpenDropdown}
            // 自己记一份组字状态：有的输入法在回车那一下把 `isComposing` 报成
            // false，只看事件属性会漏判，随后把半截拼音当成关键字提交掉。
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
              if (!submitAfterCompositionRef.current) return;
              submitAfterCompositionRef.current = false;
              // 读 DOM 上的最终值而不是 `inputVal`：`compositionend` 可能早于
              // `input` 事件，state 里还是组字前的内容。
              setTimeout(() => commitTag(inputRef.current?.value), 0);
            }}
            // 组字中失焦后 `compositionend` 有可能会丢（输入法崩溃、死键）。不把
            // 组字状态清掉的话，此后每次回车都会被当成「上屏」，回车就再也不会
            // 提交搜索了——一个只在中文用户手里复现的永久卡死。
            onBlur={() => {
              composingRef.current = false;
              submitAfterCompositionRef.current = false;
            }}
          />
        </span>
      </div>
      {open && canSwitchField && availableFields.length > 0 && (
        <div className={styles.searchDropdownPanel} onClick={e => e.stopPropagation()}>
          <div className={styles.searchDropdownTitle}>{t('选择资源属性进行过滤')}</div>
          {availableFields.map(f => (
            <div
              key={f.key}
              className={styles.searchDropdownItem}
              onMouseDown={e => e.preventDefault()}
              onClick={() => selectField(f)}
            >
              {f.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
