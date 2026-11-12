import { useEffect, useRef, useState } from 'react';
import { Alert } from 'antd';

import type { SessionClaims } from '@/auth/claims';
import { describeDebugError, stopBuiltinRun } from '@/api/stream';
import { scrollToTopOf } from '@/lib/scroll';

import AnalyzingStep from './AnalyzingStep';
import DescribeStep from './DescribeStep';
import SmartReview from './SmartReview';
import { useSmartCandidates } from './candidates';
import { createSmartDraft } from './draft';
import type { SmartDraft } from './types';
import styles from './styles.module.scss';

type Phase = 'describe' | 'analyzing' | 'review';

export interface SmartCreatePanelProps {
  active: boolean;
  claims: SessionClaims | null;
  /** 已选定的创建目标业务空间；候选目录只从这个空间取。 */
  namespace: string;
  saving: boolean;
  /** 创建提交失败时由父页面传入；展示在 review 顶部。 */
  submitError: string | null;
  onConfirm: (draft: SmartDraft) => Promise<boolean>;
  onSwitchManual: (draft: SmartDraft) => void;
  onCancel: () => void;
  /** 清掉父页面保存的提交错误；重新开始或切换模式时调用。 */
  onClearError?: () => void;
}

/**
 * 智能创建的流程壳：describe → analyzing → review。
 *
 * 组件一直挂载（切到手动模式时只是隐藏），所以草案不会因为模式切换丢失；`active`
 * 变成 false 时中止正在进行的模型调用，避免在后台白烧 token。
 */
export default function SmartCreatePanel({
  active,
  claims,
  namespace,
  saving,
  submitError,
  onConfirm,
  onSwitchManual,
  onCancel,
  onClearError,
}: SmartCreatePanelProps) {
  const candidates = useSmartCandidates(claims, namespace);
  // The candidate queries may still be in flight when the user clicks. Keep the
  // latest snapshot so `start` can wait a short grace period and then use
  // whatever has arrived instead of blocking the button forever.
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  const [phase, setPhase] = useState<Phase>('describe');
  const [goal, setGoal] = useState('');
  const [streamText, setStreamText] = useState('');
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState<SmartDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const runIDRef = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // 卸载/隐藏都要停掉流，否则用户切回手动模式后还在后台等一个不会用的结果。
  useEffect(() => {
    if (active) return;
    abortRef.current?.abort();
    abortRef.current = null;
    if (phase === 'analyzing') {
      void stopBuiltinRun(runIDRef.current);
      setPhase('describe');
    }
    // phase is read only to decide the reset; adding it would re-run on every
    // transition, which is not what this effect means.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
      void stopBuiltinRun(runIDRef.current);
    },
    []
  );

  // 阶段切换后回到内容顶部；`scrollToTopOf` 对隐藏面板是空操作，切回手动配置
  // 时不会误滚页面。
  useEffect(() => {
    scrollToTopOf(topRef.current);
  }, [phase]);

  const start = async () => {
    if (goal.trim() === '') return;
    onClearError?.();

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    runIDRef.current = null;

    setError(null);
    setStreamText('');
    setStatus('正在读取可用能力…');
    setPhase('analyzing');

    // Give the candidate queries a short grace period. A slow auxiliary query
    // (name lookup, for example) must not hold the primary button in a loading
    // state; after the deadline the prompt is built from what has arrived.
    const deadline = Date.now() + 3000;
    while (!controller.signal.aborted && candidatesRef.current.loading && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (controller.signal.aborted) return;
    const current = candidatesRef.current;

    try {
      const result = await createSmartDraft({
        goal: goal.trim(),
        catalog: current.catalog,
        existingAgentNames: current.existingAgentNames,
        preferredNamespace: namespace,
        signal: controller.signal,
        onStatus: setStatus,
        onText: setStreamText,
        onRunID: runID => {
          runIDRef.current = runID;
        },
      });
      if (abortRef.current !== controller) return;
      // A local fallback means the model run did not produce a usable answer;
      // stop it if it is still alive. The endpoint ignores an already-finished
      // run, and `stopBuiltinRun` swallows errors.
      if (result.engine === 'local' && runIDRef.current) {
        void stopBuiltinRun(runIDRef.current);
      }
      setDraft(result);
      setPhase('review');
    } catch (err) {
      if (abortRef.current !== controller) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(describeDebugError(err, '智能匹配失败'));
      setPhase('describe');
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    void stopBuiltinRun(runIDRef.current);
    onClearError?.();
    setPhase('describe');
    setStatus('');
  };

  return (
    <div ref={topRef} className={styles.panel}>
      {error && (
        <Alert
          type="error"
          showIcon
          className={styles.alert}
          title="智能匹配没有完成"
          description={error}
        />
      )}

      {phase === 'describe' && (
        <DescribeStep
          goal={goal}
          counts={candidates.counts}
          loading={candidates.loading}
          error={candidates.error}
          onGoalChange={setGoal}
          onStart={() => void start()}
          onRetry={candidates.refetch}
          onCancel={onCancel}
        />
      )}

      {phase === 'analyzing' && (
        <AnalyzingStep goal={goal} status={status} streamText={streamText} onStop={stop} />
      )}

      {phase === 'review' && draft && (
        <SmartReview
          goal={goal}
          draft={draft}
          catalog={candidates.catalog}
          existingAgentNames={candidates.existingAgentNames}
          preferredNamespace={namespace}
          saving={saving}
          submitError={submitError}
          onChange={setDraft}
          onConfirm={() => void onConfirm(draft)}
          onBack={() => {
            onClearError?.();
            setPhase('describe');
          }}
          onRegenerate={() => void start()}
          onSwitchManual={() => {
            onClearError?.();
            onSwitchManual(draft);
          }}
        />
      )}
    </div>
  );
}
