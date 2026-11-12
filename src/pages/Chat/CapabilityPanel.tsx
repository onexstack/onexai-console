import { useState } from 'react';
import { Button, Checkbox, Empty, Space, Spin, Tag, Typography } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';

import type { CapabilitySelection, EffectiveAgent, SelectableCapability } from '@/api/types';

import { CAPABILITY_LABELS, SELECTABLE_CAPABILITIES, selectionCounts } from './capabilities';

type Capabilities = NonNullable<EffectiveAgent['capabilities']>;

/**
 * 能力检查器（设置子页里的测试模式）。
 *
 * 普通模式下它只是「这个智能体有什么」；测试模式下同一块位置变成可勾选的
 * 子集。两者共用一个面板，是因为它们回答的是同一个问题，只是后者允许改动
 * 答案 —— 分成两块会让「我刚才看的是哪一种」成为新的记忆负担。
 */
export function CapabilityPanel({
  capabilities,
  observed,
  bindingsTotal,
  loading,
  error,
  selection,
  resetNote,
  onChange,
  onSelectAll,
  onClearAll,
  onRestore,
}: {
  capabilities?: Capabilities;
  observed?: boolean;
  bindingsTotal?: number;
  loading: boolean;
  error: boolean;
  selection: CapabilitySelection;
  resetNote: boolean;
  onChange: (kind: SelectableCapability, names: string[]) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onRestore: () => void;
}) {
  if (loading) return <Spin size="small" />;
  if (error) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        无法读取生效能力（需要管理员或该智能体不可见）。
      </Typography.Text>
    );
  }
  if (!capabilities) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有能力数据" />;
  }

  const counts = selectionCounts(selection, capabilities);
  const nothingSelected = counts.selected === 0;

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        本次运行只使用勾选的能力；不修改能力编排。
      </Typography.Text>

      <div className="flex items-center justify-between">
        <Typography.Text style={{ fontSize: 12 }}>
          已选 <strong>{counts.selected}</strong>/{counts.total}
        </Typography.Text>
        <Space size={2}>
          <Button type="link" size="small" onClick={onSelectAll}>
            全选
          </Button>
          <Button type="link" size="small" onClick={onClearAll}>
            清空
          </Button>
          <Button type="link" size="small" onClick={onRestore}>
            恢复
          </Button>
        </Space>
      </div>

      {resetNote && (
        <Typography.Text type="warning" style={{ fontSize: 11 }}>
          生效能力已更新，选择已重置。
        </Typography.Text>
      )}

      {nothingSelected && (
        <div className="rounded bg-[var(--color-bg-secondary)] px-2 py-1 text-[11px] text-[var(--color-warning)]">
          未选择任何能力：本次运行不会有 Skill、MCP 工具、知识库或自定义命令（内置工具不受影响）。
        </div>
      )}

      {SELECTABLE_CAPABILITIES.map(kind => (
        <CapabilityGroup
          key={kind}
          label={CAPABILITY_LABELS[kind]}
          all={capabilities[kind] ?? []}
          selected={selection[kind]}
          onChange={names => onChange(kind, names)}
        />
      ))}

      <div className="border-t border-[var(--color-border-secondary)] pt-2">
        <CapabilityRow label="会话命令（只读）" values={capabilities.commands} />
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          由聊天入口消费，调试运行不读取。
        </Typography.Text>
        <div className="mt-2">
          <CapabilityRow label="需审批（只读）" values={capabilities.requireApproval} />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          审批策略是安全下限，测试模式不能关闭。
        </Typography.Text>
      </div>

      <FootNote observed={observed} bindingsTotal={bindingsTotal} />
    </Space>
  );
}

function CapabilityGroup({
  label,
  all,
  selected,
  onChange,
}: {
  label: string;
  all: string[];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const total = all.length;
  const checked = total > 0 && selected.length === total;
  const indeterminate = selected.length > 0 && selected.length < total;

  const toggle = (name: string) => {
    onChange(
      selected.includes(name) ? selected.filter(value => value !== name) : [...selected, name]
    );
  };

  return (
    <div className="rounded-md border border-[var(--color-border-secondary)]">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          aria-label={open ? `收起 ${label}` : `展开 ${label}`}
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
          className="flex w-4 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[10px] text-[var(--color-text-tertiary)]"
        >
          {open ? <DownOutlined /> : <RightOutlined />}
        </button>
        <Checkbox
          checked={checked}
          indeterminate={indeterminate}
          disabled={total === 0}
          onChange={() => onChange(checked ? [] : [...all])}
        >
          <span className="text-[12px]">{label}</span>
        </Checkbox>
        <span className="ml-auto text-[11px] text-[var(--color-text-tertiary)]">
          {selected.length}/{total}
        </span>
      </div>

      {open &&
        (total === 0 ? (
          <div className="px-2 pb-2 text-[11px] text-[var(--color-text-tertiary)]">—</div>
        ) : (
          <div className="max-h-[180px] overflow-y-auto px-2 pb-1.5">
            {all.map(name => (
              <label
                key={name}
                title={name}
                className="flex cursor-pointer items-center gap-1.5 py-0.5"
              >
                <Checkbox
                  checked={selected.includes(name)}
                  onChange={() => toggle(name)}
                  style={{ marginInlineEnd: 0 }}
                />
                <span className="truncate font-mono text-[11px] text-[var(--color-text)]">
                  {name}
                </span>
              </label>
            ))}
          </div>
        ))}
    </div>
  );
}

export function CapabilityRow({ label, values }: { label: string; values?: string[] }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-[var(--color-text-tertiary)]">{label}</div>
      {values && values.length > 0 ? (
        <Space size={[4, 4]} wrap>
          {values.map(value => (
            <Tag key={value} style={{ marginInlineEnd: 0 }}>
              {value}
            </Tag>
          ))}
        </Space>
      ) : (
        <span className="text-[12px] text-[var(--color-text-tertiary)]">—</span>
      )}
    </div>
  );
}

function FootNote({ observed, bindingsTotal }: { observed?: boolean; bindingsTotal?: number }) {
  return (
    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
      {observed ? '控制器已观测' : '控制器尚未观测'}
      {bindingsTotal ? ` · ${bindingsTotal} 条绑定贡献` : ''}
    </Typography.Text>
  );
}
