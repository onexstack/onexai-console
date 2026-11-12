import { Empty, Select, Spin, Switch, Tag } from 'antd';

import type { CapabilitySelection, EffectiveAgent, SelectableCapability } from '@/api/types';
import { OptionLabel } from '@/components/OptionLabel';
import { matchOptionText } from '@/components/OptionLabel/helpers';

import { CapabilityPanel } from '../CapabilityPanel';
import type { AgentOption } from './types';
import { SubpageHeader } from './SubpageHeader';
import styles from './settings.module.scss';

export function SettingsPanel({
  agents,
  agentsLoading,
  agent,
  onAgentChange,
  reasoning,
  onReasoningChange,
  effective,
  effectiveLoading,
  effectiveError,
  testMode,
  onTestModeChange,
  selection,
  onSelectionChange,
  onSelectAll,
  onClearAll,
  onRestore,
  resetNote,
  external,
  closeLabel,
  onClose,
}: {
  agents: AgentOption[];
  agentsLoading: boolean;
  agent: string;
  onAgentChange: (name: string) => void;
  reasoning: boolean;
  onReasoningChange: (next: boolean) => void;
  effective?: EffectiveAgent;
  effectiveLoading: boolean;
  effectiveError: boolean;
  testMode: boolean;
  onTestModeChange: (next: boolean) => void;
  selection: CapabilitySelection;
  onSelectionChange: (kind: SelectableCapability, names: string[]) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onRestore: () => void;
  resetNote: boolean;
  /** 外部 A2A 智能体：能力由对端决定，没有测试模式。 */
  external: boolean;
  /** 关闭按钮文案：停靠在右侧时用「收起」。 */
  closeLabel?: string;
  onClose: () => void;
}) {
  const capabilities = effective?.capabilities;
  const canTest = Boolean(capabilities) && !effectiveLoading && !effectiveError && !external;

  return (
    <div className={styles.panel}>
      <SubpageHeader title="智能体设置" closeLabel={closeLabel} onClose={onClose} />

      <div className={styles.body}>
        <section className={styles.section}>
          <div className={styles.sectionTitle}>智能体</div>
          <div className={styles.sectionDesc}>
            能力由智能体的绑定决定；需要逐轮调整时打开下方的测试模式（仅作用于本次运行，
            不改绑定）。切换智能体等于切换服务端记忆桶。
          </div>
          <Select
            className={styles.agentSelect}
            value={agent || undefined}
            onChange={onAgentChange}
            showSearch
            loading={agentsLoading}
            placeholder="选择智能体"
            options={agents}
            optionRender={option => {
              const data = option.data as AgentOption;
              // 描述同时参与搜索：只按显示名过滤会让「按用途找智能体」失效。
              return <OptionLabel title={option.label} description={data.description} />;
            }}
            filterOption={(input, option) =>
              matchOptionText(input, option?.label, option?.description)
            }
          />
        </section>

        <div className={styles.divider} />

        <section className={styles.section}>
          <div className={styles.sectionRow}>
            <div>
              <div className={styles.sectionTitle}>默认开启思考</div>
              <div className={styles.sectionDesc}>
                开启后每次请求推理流，助手会先展示思考过程再给出回答。
              </div>
            </div>
            <Switch checked={reasoning} onChange={onReasoningChange} />
          </div>
        </section>

        <div className={styles.divider} />

        <section className={styles.section}>
          <div className={styles.sectionTitle}>服务端记忆</div>
          <div className={styles.sectionDesc}>
            服务端按「智能体 × 当前管理员」保留一份记忆；本机历史只存在这个浏览器里。
            清除本机记录不会清空服务端记忆。
          </div>
        </section>

        <div className={styles.divider} />

        <section className={styles.section}>
          <div className={styles.sectionRow}>
            <div>
              <div className={styles.sectionTitle}>生效能力</div>
              <div className={styles.sectionDesc}>
                能力由智能体的绑定决定。测试模式可以只启用其中一部分，仅作用于本次运行，
                不会修改绑定。
              </div>
            </div>
            <Switch
              checked={testMode}
              disabled={!canTest}
              onChange={onTestModeChange}
              checkedChildren="测试"
              unCheckedChildren="正常"
            />
          </div>

          {external ? (
            <div className={styles.sectionDesc}>
              外部 A2A 智能体的能力、模型与工具由对端 AgentCard
              决定，本页不能收窄；可在智能体详情的「AgentCard」「技能」页签查看。
            </div>
          ) : effectiveLoading ? (
            <Spin size="small" />
          ) : effectiveError ? (
            <div className={styles.sectionDesc}>
              无法读取生效能力（需要管理员或该智能体不可见）。
            </div>
          ) : !capabilities ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有能力数据" />
          ) : testMode ? (
            <CapabilityPanel
              capabilities={capabilities}
              observed={effective?.observed}
              bindingsTotal={effective?.bindings?.total}
              loading={false}
              error={false}
              selection={selection}
              resetNote={resetNote}
              onChange={onSelectionChange}
              onSelectAll={onSelectAll}
              onClearAll={onClearAll}
              onRestore={onRestore}
            />
          ) : (
            <div className={styles.capabilities}>
              <CapabilityRow label="Skill" values={capabilities.skills} />
              <CapabilityRow label="MCP" values={capabilities.mcps} />
              <CapabilityRow label="知识库" values={capabilities.knowledgeBases} />
              <CapabilityRow label="自定义命令" values={capabilities.customCommands} />
              <CapabilityRow label="命令" values={capabilities.commands} />
              <CapabilityRow label="需审批" values={capabilities.requireApproval} />
              <div className={styles.sectionDesc}>
                {effective?.observed ? '控制器已观测' : '控制器尚未观测'}
                {effective?.bindings?.total ? ` · ${effective.bindings.total} 条绑定贡献` : ''}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CapabilityRow({ label, values }: { label: string; values?: string[] }) {
  return (
    <div className={styles.capabilityRow}>
      <div className={styles.capabilityLabel}>{label}</div>
      {values && values.length > 0 ? (
        <div className={styles.capabilityTags}>
          {values.map(value => (
            <Tag key={value}>{value}</Tag>
          ))}
        </div>
      ) : (
        <span className={styles.capabilityEmpty}>—</span>
      )}
    </div>
  );
}
