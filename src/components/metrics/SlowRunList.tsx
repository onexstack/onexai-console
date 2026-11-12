import { Link } from 'react-router';
import { Tag } from 'antd';

import type { MonitorRunSummary } from '@/api/agentMonitor';
import { slowRunRatio } from './chartOptions';
import { formatDuration, runStateMeta, runTriggerLabel } from './format';
import styles from './styles.module.scss';

/**
 * 最慢运行排行。
 *
 * 抽屉里是单个智能体，归属列重复；观测中心的全平台视图需要 `showAgent` 才
 * 能看出慢的是谁，所以归属作为可选副行信息。
 */
export default function SlowRunList({
  runs,
  showAgent = false,
}: {
  runs: MonitorRunSummary[];
  showAgent?: boolean;
}) {
  return (
    <ol className={styles.runList}>
      {runs.map((run, index) => {
        const state = runStateMeta(run.state);
        return (
          <li key={run.id} className={styles.runRow}>
            <span className={styles.runRank}>{index + 1}</span>
            <span className={styles.runMain}>
              {/* 交互式运行没有 admission，异步任务详情页打不开它。 */}
              {run.source === 'run' ? (
                <span className={styles.runId} title={run.id}>
                  {run.id}
                </span>
              ) : (
                <Link
                  to={`/async-tasks/${encodeURIComponent(run.id)}`}
                  className={styles.runId}
                  title={run.id}
                >
                  {run.id}
                </Link>
              )}
              <span className={styles.runMeta}>
                <Tag color={state.color} className={styles.runTag}>
                  {state.text}
                </Tag>
                {runTriggerLabel(run.trigger)}
                {showAgent && run.agent ? ` · ${run.agent}` : ''}
              </span>
            </span>
            <span className={styles.runBarTrack} aria-hidden>
              <span
                className={styles.runBar}
                style={{ width: `${slowRunRatio(run, runs) * 100}%` }}
              />
            </span>
            <span className={styles.runDuration}>{formatDuration(run.durationMs)}</span>
          </li>
        );
      })}
    </ol>
  );
}
