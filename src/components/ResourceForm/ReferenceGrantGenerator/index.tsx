import { useEffect, useMemo, useState } from 'react';
import { Alert, AutoComplete, Button, Collapse, Form, Input, Select, Space } from 'antd';
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';

import DeleteIcon from '@/components/DeleteIcon';
import {
  REFERENCE_GRANT_FROM_KIND,
  REFERENCE_GRANT_GROUP,
  buildFromJson,
  buildToJson,
  fromGrantIssue,
  newFromRow,
  newToRow,
  parseFromRows,
  parseToRows,
  toGrantIssue,
  type GrantFromRow,
  type GrantToRow,
} from '@/lib/reference-grant';
import { ResizableDrawer } from '@/ui';

import {
  REFERENCE_GRANT_TARGET_KINDS,
  TARGET_RESOURCE_BY_KIND,
  useNamespaceOptions,
  useResourceRows,
  type SelectOption,
} from '../options';
import styles from './styles.module.scss';

/** from / to 各有一个按钮与一份抽屉，互不干扰。 */
export type GrantSide = 'from' | 'to';

/** 「全部目标」在下拉里的哨兵值：空字符串会被 antd 当成未选择。 */
const ALL_TARGETS = '__all__';

const TARGET_KIND_OPTIONS = REFERENCE_GRANT_TARGET_KINDS.map(({ kind }) => ({
  value: kind,
  label: kind,
}));

/**
 * 「引用授权」的授权生成器。
 *
 * from / to 各渲染一个按钮与一份抽屉：引用方抽屉只改 `from`，目标抽屉只改 `to`。
 * 打开时解析对应输入框的现有 JSON 回填；确定后只写回该字段，另一个字段保持原样。
 */
export default function ReferenceGrantGenerator({
  side,
  disabled,
}: {
  side: GrantSide;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<ThunderboltOutlined />} disabled={disabled} onClick={() => setOpen(true)}>
        授权生成器
      </Button>
      <ReferenceGrantDrawer side={side} active={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ReferenceGrantDrawer({
  side,
  active,
  onClose,
}: {
  side: GrantSide;
  active: boolean;
  onClose: () => void;
}) {
  const form = Form.useFormInstance();
  const namespaceValue = Form.useWatch('namespace', form);
  const targetNamespace = typeof namespaceValue === 'string' ? namespaceValue.trim() : '';

  const [fromRows, setFromRows] = useState<GrantFromRow[]>([]);
  const [toRows, setToRows] = useState<GrantToRow[]>([]);
  const [parseWarning, setParseWarning] = useState<string | null>(null);

  // 每次打开都只读当前这一侧：用户可能刚手改过 textarea。
  useEffect(() => {
    if (!active) return;
    if (side === 'from') {
      const parsed = parseFromRows(form.getFieldValue('from'));
      setFromRows(parsed.rows.length ? parsed.rows : [newFromRow()]);
      setParseWarning(
        parsed.invalid
          ? '现有 from 内容不是合法的 JSON 数组，生成器已从空白开始；点击「确定」会覆盖原内容。'
          : null
      );
      return;
    }
    const parsed = parseToRows(form.getFieldValue('to'));
    setToRows(parsed.rows.length ? parsed.rows : [newToRow()]);
    setParseWarning(
      parsed.invalid
        ? '现有 to 内容不是合法的 JSON 数组，生成器已从空白开始；点击「确定」会覆盖原内容。'
        : null
    );
  }, [active, form, side]);

  // 引用方可能是 default 里的内置 Agent；default 是系统空间，业务空间候选里
  // 没有它，但授权必须能选到它。
  const { options: namespaceOptions, loading: namespaceLoading } = useNamespaceOptions({
    includeSystem: true,
  });

  // 同命名空间引用不需要授权，所以引用方候选里不出现目标空间。
  const fromNamespaceOptions = useMemo(
    () => namespaceOptions.filter(option => option.value !== targetNamespace),
    [namespaceOptions, targetNamespace]
  );

  const issue = side === 'from' ? fromGrantIssue(fromRows) : toGrantIssue(toRows);
  const title = side === 'from' ? '引用方（from）授权生成器' : '目标（to）授权生成器';

  const confirm = () => {
    if (issue) return;
    if (side === 'from') {
      form.setFieldsValue({ from: buildFromJson(fromRows) });
    } else {
      form.setFieldsValue({ to: buildToJson(toRows) });
    }
    onClose();
  };

  const patchFrom = (next: GrantFromRow) =>
    setFromRows(rows => rows.map(row => (row.id === next.id ? next : row)));
  const patchTo = (next: GrantToRow) =>
    setToRows(rows => rows.map(row => (row.id === next.id ? next : row)));

  return (
    <ResizableDrawer
      open={active}
      title={title}
      defaultWidth={680}
      minWidth={480}
      storageKey={`reference-grant-generator-${side}`}
      destroyOnHidden
      onClose={onClose}
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" disabled={Boolean(issue)} onClick={confirm}>
            确定
          </Button>
        </Space>
      }
    >
      <div className={styles.body}>
        {parseWarning && <Alert type="warning" showIcon title={parseWarning} />}

        <Alert
          type="info"
          showIcon
          title={
            targetNamespace
              ? `目标命名空间：${targetNamespace}（来自表单）`
              : '请先在表单填写「目标命名空间」'
          }
          description={
            side === 'from'
              ? `资源组与类型固定为 ${REFERENCE_GRANT_GROUP} / ${REFERENCE_GRANT_FROM_KIND}；这里只选择允许发起引用的命名空间。`
              : `资源组固定为 ${REFERENCE_GRANT_GROUP}；名称选「全部」表示该类型的全部对象。`
          }
        />

        {side === 'from' ? (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>引用方（from）</h3>
            <p className={styles.hint}>选择允许发起跨空间引用的命名空间；同一个空间只需一条。</p>
            {fromRows.map(row => (
              <FromRowEditor
                key={row.id}
                row={row}
                namespaceOptions={fromNamespaceOptions}
                namespaceLoading={namespaceLoading}
                onChange={patchFrom}
                onRemove={() => setFromRows(rows => rows.filter(item => item.id !== row.id))}
              />
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => setFromRows(rows => [...rows, newFromRow()])}
            >
              添加引用方
            </Button>
          </section>
        ) : (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>目标（to）</h3>
            <p className={styles.hint}>选择被引用的对象；名称选「全部」表示该类型的全部对象。</p>
            {toRows.map(row => (
              <ToRowEditor
                key={row.id}
                row={row}
                active={active}
                targetNamespace={targetNamespace}
                onChange={patchTo}
                onRemove={() => setToRows(rows => rows.filter(item => item.id !== row.id))}
              />
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => setToRows(rows => [...rows, newToRow()])}
            >
              添加目标
            </Button>
          </section>
        )}

        {issue && <Alert type="warning" showIcon title={issue} />}

        <Collapse
          className={styles.preview}
          items={[
            {
              key: 'json',
              label: '预览将要写回的 JSON',
              children: (
                <div>
                  <div className={styles.previewLabel}>{side}</div>
                  <pre className={styles.code}>
                    {side === 'from' ? buildFromJson(fromRows) : buildToJson(toRows)}
                  </pre>
                </div>
              ),
            },
          ]}
        />
      </div>
    </ResizableDrawer>
  );
}

interface RowEditorProps<T> {
  row: T;
  onChange: (next: T) => void;
  onRemove: () => void;
}

interface FromRowEditorProps extends RowEditorProps<GrantFromRow> {
  namespaceOptions: SelectOption[];
  namespaceLoading: boolean;
}

function FromRowEditor({
  row,
  namespaceOptions,
  namespaceLoading,
  onChange,
  onRemove,
}: FromRowEditorProps) {
  return (
    <div className={styles.row}>
      <span className={styles.fixedGroup} title="资源组（固定）">
        {REFERENCE_GRANT_GROUP}
      </span>
      <span className={styles.fixedKind} title="类型（固定）">
        {REFERENCE_GRANT_FROM_KIND}
      </span>
      <AutoComplete
        className={styles.grow}
        value={row.namespace}
        options={namespaceOptions}
        onChange={value => onChange({ ...row, namespace: String(value ?? '') })}
        placeholder="引用方命名空间"
        allowClear
        notFoundContent={namespaceLoading ? '加载中…' : '没有候选，可直接输入'}
      />
      <Button type="text" danger icon={<DeleteIcon />} aria-label="删除引用方" onClick={onRemove} />
    </div>
  );
}

interface ToRowEditorProps extends RowEditorProps<GrantToRow> {
  /** 抽屉是否打开：关闭时不拉取资源候选。 */
  active: boolean;
  targetNamespace: string;
}

function ToRowEditor({ row, active, targetNamespace, onChange, onRemove }: ToRowEditorProps) {
  const resourceKey = active && targetNamespace ? TARGET_RESOURCE_BY_KIND[row.kind] : undefined;
  const query = useResourceRows(resourceKey);

  const kindOptions = useMemo(() => {
    const options = TARGET_KIND_OPTIONS.slice();
    if (row.kind && !REFERENCE_GRANT_TARGET_KINDS.some(item => item.kind === row.kind)) {
      options.push({ value: row.kind, label: `${row.kind}（未识别）` });
    }
    return options;
  }, [row.kind]);

  const nameOptions = useMemo(() => {
    const all = { value: ALL_TARGETS, label: '全部' };
    if (!resourceKey || !targetNamespace) {
      return row.name ? [all, { value: row.name, label: `${row.name}（未匹配资源列表）` }] : [all];
    }
    const names = [
      ...new Set(
        (query.data ?? [])
          .filter(item => !item.namespace || String(item.namespace) === targetNamespace)
          .map(item => String(item.name ?? ''))
          .filter(Boolean)
      ),
    ].sort();
    const options = names.map(name => ({ value: name, label: name }));
    // 编辑既有授权时，目标资源可能已删除或位于另一个空间：保留原值。
    if (row.name && !names.includes(row.name)) {
      options.unshift({ value: row.name, label: `${row.name}（目标空间内未找到）` });
    }
    return [all, ...options];
  }, [query.data, resourceKey, targetNamespace, row.name]);

  return (
    <div className={styles.row}>
      <span className={styles.fixedGroup} title="资源组（固定）">
        {REFERENCE_GRANT_GROUP}
      </span>
      <Select
        className={styles.kind}
        value={row.kind || undefined}
        options={kindOptions}
        onChange={value => onChange({ ...row, kind: String(value), name: '' })}
        placeholder="类型"
      />
      {resourceKey ? (
        <Select
          className={styles.grow}
          showSearch
          optionFilterProp="label"
          loading={query.isLoading}
          options={nameOptions}
          value={row.name === '' ? ALL_TARGETS : row.name}
          onChange={value => onChange({ ...row, name: value === ALL_TARGETS ? '' : String(value) })}
          placeholder="选择对象"
        />
      ) : (
        <Input
          className={styles.grow}
          value={row.name}
          onChange={event => onChange({ ...row, name: event.target.value })}
          placeholder="对象名称；留空表示全部"
        />
      )}
      <Button type="text" danger icon={<DeleteIcon />} aria-label="删除目标" onClick={onRemove} />
    </div>
  );
}
