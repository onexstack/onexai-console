import { Descriptions, Empty, Tag, Timeline, Typography } from 'antd';

import type { DebugUsage } from '@/api/stream';
import { ResizableDrawer } from '@/ui';
import CopyButton from '@/ui/components/CopyButton';

import { compositionSummary, compositionCounts } from './debugComposition';
import type { DebugSessionRecord, DebugTurnLog } from './debugStore';
import type { AgentRunState } from '../useAgentRun';
import styles from './debug.module.scss';

/**
 * 调试日志。
 *
 * 只展示名称、计数和流元数据：提示词内容与消息正文属于对话本身，复制到
 * issue 里既没必要也容易泄露业务信息。工具步骤的 result 是后端返回的，保留但
 * 截断。
 */
export function DebugLogDrawer({
  open,
  onClose,
  subject,
  subjectLabel,
  session,
  run,
}: {
  open: boolean;
  onClose: () => void;
  /** 当前登录用户的真实 ID：无宿主运行的执行主体，诊断信息里保留原值。 */
  subject?: string;
  /** 展示用的用户名/显示名；缺失时回退到 subject。 */
  subjectLabel?: string;
  session: DebugSessionRecord;
  run: AgentRunState;
}) {
  const counts = compositionCounts(session.composition);
  const live: DebugTurnLog | null =
    run.status === 'idle'
      ? null
      : {
          id: run.runId ?? 'live',
          at: run.startedAt ?? Date.now(),
          composition: session.composition,
          reasoning: false,
          status:
            run.status === 'streaming'
              ? 'streaming'
              : run.status === 'suspended'
                ? 'suspended'
                : run.status === 'error'
                  ? 'error'
                  : run.status === 'stopped'
                    ? 'stopped'
                    : 'done',
          runId: run.runId ?? undefined,
          durationMs: run.startedAt ? Date.now() - run.startedAt : undefined,
          usage: run.usage,
          steps: run.steps,
          error: run.error ?? undefined,
          model: session.composition.model || undefined,
        };

  const diagnostics = {
    mode: 'hostless',
    subject,
    nonce: session.nonce,
    composition: session.composition,
    turns: live ? [...session.turns, live] : session.turns,
  };

  return (
    <ResizableDrawer
      open={open}
      onClose={onClose}
      defaultWidth={560}
      minWidth={360}
      storageKey="chat_debug_log"
      // 原生全屏时只有全屏元素子树可见，portal 到 body 会被挡在外面。
      getContainer={false}
      title="调试日志"
      className={styles.drawer}
      extra={<CopyButton value={JSON.stringify(diagnostics, null, 2)} ariaLabel="复制诊断信息" />}
    >
      <Descriptions size="small" column={2} className={styles.logMeta}>
        <Descriptions.Item label="执行身份">{subjectLabel || subject || '—'}</Descriptions.Item>
        <Descriptions.Item label="会话">{session.nonce.slice(0, 8)}</Descriptions.Item>
        <Descriptions.Item label="模型">
          {session.composition.model || '部署默认（未指定）'}
        </Descriptions.Item>
        <Descriptions.Item label="已选">
          提示词 {counts.prompts} · MCP {counts.mcps} · 命令 {counts.customCommands} · Skill{' '}
          {counts.skills} · 知识库 {counts.knowledgeBases}
        </Descriptions.Item>
      </Descriptions>

      <Typography.Paragraph type="secondary" className={styles.logComposition}>
        {compositionSummary(session.composition)}
      </Typography.Paragraph>

      {run.events.length > 0 ? (
        <div className={styles.logEvents}>
          <div className={styles.logEventsTitle}>事件流</div>
          {run.events.slice(-40).map((item, index) => (
            <div key={`${item.at}-${index}`} className={styles.logEvent}>
              <span>{new Date(item.at).toLocaleTimeString()}</span>
              <span>{item.event.type}</span>
              {item.event.type === 'step' ? <span>{item.event.steps.length} steps</span> : null}
              {item.event.type === 'error' ? <span>{item.event.error}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {!live && session.turns.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有运行记录" />
      ) : (
        <Timeline
          className={styles.logTimeline}
          items={[...session.turns, ...(live ? [live] : [])].map((turn, index) => ({
            key: `${turn.id}-${index}`,
            color:
              turn.status === 'done'
                ? 'green'
                : turn.status === 'error'
                  ? 'red'
                  : turn.status === 'suspended'
                    ? 'orange'
                    : 'blue',
            children: <TurnLog turn={turn} />,
          }))}
        />
      )}
    </ResizableDrawer>
  );
}

function TurnLog({ turn }: { turn: DebugTurnLog }) {
  return (
    <div className={styles.logTurn}>
      <div className={styles.logTurnHead}>
        <Tag>{turn.status}</Tag>
        {turn.model ? <Tag>{turn.model}</Tag> : null}
        {turn.runId ? <span className={styles.logRunID}>{turn.runId}</span> : null}
        {turn.durationMs ? <span>{formatDuration(turn.durationMs)}</span> : null}
      </div>
      <div className={styles.logTime}>{new Date(turn.at).toLocaleString()}</div>

      {turn.error ? <div className={styles.logError}>{turn.error}</div> : null}

      {turn.steps && turn.steps.length > 0 ? (
        <div className={styles.logSteps}>
          {turn.steps.map((step, index) => (
            <div key={step.id ?? `${step.name}-${index}`} className={styles.logStep}>
              <span
                className={
                  step.status === 'fail'
                    ? styles.stepFail
                    : step.status === 'ok'
                      ? styles.stepOk
                      : undefined
                }
              >
                {step.name || '工具'}
              </span>
              <span>{step.status}</span>
              {step.durationMs ? <span>{step.durationMs}ms</span> : null}
              {step.tokens ? <span>{step.tokens} tokens</span> : null}
              {step.result ? <span className={styles.logResult}>{step.result}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {turn.usage ? <Usage usage={turn.usage} /> : null}
    </div>
  );
}

function Usage({ usage }: { usage: DebugUsage }) {
  return (
    <div className={styles.logUsage}>
      prompt {usage.promptTokens ?? '-'} · completion {usage.completionTokens ?? '-'} · reasoning{' '}
      {usage.reasoningTokens ?? '-'} · calls {usage.calls ?? '-'}
      {usage.cacheHitTokens ? ` · cache hit ${usage.cacheHitTokens}` : ''}
    </div>
  );
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}
