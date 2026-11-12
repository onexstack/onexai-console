import { Alert, Button, Input } from 'antd';

import { SMART_KINDS, type SmartCounts } from './types';
import styles from './styles.module.scss';

const EXAMPLES = [
  '创建一个 K8s 告警根因分析助手，需要查询告警、日志和发布记录',
  '做一个基于内部研发规范文档的代码评审助手',
  '创建一个能查工单、汇总值班信息并生成周报的值班助手',
];

export interface DescribeStepProps {
  goal: string;
  counts: SmartCounts;
  loading: boolean;
  error: string | null;
  onGoalChange: (goal: string) => void;
  onStart: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

/** 第一步：描述目标。纯输入，不发请求；「智能匹配」由面板统一发起。 */
export default function DescribeStep({
  goal,
  counts,
  loading,
  error,
  onGoalChange,
  onStart,
  onRetry,
  onCancel,
}: DescribeStepProps) {
  const empty = SMART_KINDS.every(item => counts[item.kind] === 0);
  const available = SMART_KINDS.filter(item => counts[item.kind] > 0);

  return (
    <div className={styles.describe}>
      <div className={styles.hero}>
        <p className={styles.heroText}>
          描述你要解决的问题。AI 会从你有权使用且已启用的 AI
          能力中，挑选最匹配的组合，生成可直接创建的草案。
        </p>
      </div>

      {error && (
        <Alert
          type="warning"
          showIcon
          className={styles.alert}
          title="候选资源没有完全加载"
          description={error}
          action={
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          }
        />
      )}

      <div className={styles.promptCard}>
        <label className={styles.promptLabel} htmlFor="smart-create-goal">
          目标描述
        </label>
        <Input.TextArea
          id="smart-create-goal"
          className={styles.promptInput}
          value={goal}
          onChange={event => onGoalChange(event.target.value)}
          placeholder="例如：创建一个能查询 K8s 告警、关联日志与发布记录，并给出根因分析的 SRE 助手"
          autoSize={{ minRows: 5, maxRows: 10 }}
          maxLength={2000}
          showCount
        />
        <div className={styles.examples}>
          <span className={styles.examplesLabel}>试试：</span>
          {EXAMPLES.map(example => (
            <button
              key={example}
              type="button"
              className={styles.exampleChip}
              onClick={() => onGoalChange(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.availability} aria-live="polite">
        <span className={styles.availabilityLabel}>当前可用</span>
        {available.map(item => (
          <span key={item.kind} className={styles.availabilityItem}>
            {item.label}
            <strong>{counts[item.kind]}</strong>
          </span>
        ))}
        {available.length === 0 && (
          <span className={styles.availabilityEmpty}>暂无已启用的资源</span>
        )}
        {loading && <span className={styles.availabilityMuted}>正在读取…</span>}
      </div>

      {empty && !loading && (
        <Alert
          type="info"
          showIcon
          className={styles.alert}
          title="当前没有可用能力"
          description="仍可创建一个只使用部署默认模型的基础智能体；也可以先去「能力中心」创建知识库、MCP、Skill 或命令。"
        />
      )}

      <p className={styles.hint}>
        候选范围：已启用的知识库 / MCP / Skill / 命令，以及平台共享或你本人创建的模型。
        运行时的平台授权仍会再次校验所选能力。
      </p>

      <div className={styles.actions}>
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" disabled={goal.trim() === ''} onClick={onStart}>
          智能匹配
        </Button>
      </div>
    </div>
  );
}
