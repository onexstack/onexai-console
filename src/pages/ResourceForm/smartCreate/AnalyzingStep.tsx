import { Button } from 'antd';

import { SparkleIcon } from '@/ui';

import styles from './styles.module.scss';

export interface AnalyzingStepProps {
  goal: string;
  status: string;
  streamText: string;
  onStop: () => void;
}

/**
 * 第二步：分析中。
 *
 * 阶段文字来自真实进度（候选已加载 / 模型调用 / 校验），不画百分比；模型输出
 * 放在可折叠区域，默认不把一屏 JSON 推到用户脸上。
 */
export default function AnalyzingStep({ goal, status, streamText, onStop }: AnalyzingStepProps) {
  return (
    <div className={styles.analyzing}>
      <section className={styles.analyzingCard} aria-live="polite">
        <div className={styles.analyzingHead}>
          <span className={styles.orb} aria-hidden>
            <SparkleIcon size={18} />
          </span>
          <div>
            <h2 className={styles.analyzingTitle}>正在理解你的目标</h2>
            <p className={styles.analyzingStatus}>{status}</p>
          </div>
        </div>

        <div className={styles.goalQuote}>
          <span className={styles.goalQuoteLabel}>目标</span>
          <span>{goal}</span>
        </div>

        <div className={styles.progressTrack} role="progressbar" aria-label="智能匹配进行中">
          <span className={styles.progressBar} />
        </div>

        <ol className={styles.stageList}>
          <li className={styles.stageDone}>读取可用能力</li>
          <li className={styles.stageActive}>调用模型筛选</li>
          <li>校验推荐结果</li>
        </ol>

        {streamText && (
          <details className={styles.streamDetails}>
            <summary>查看模型输出（{streamText.length} 字）</summary>
            <pre className={styles.streamText}>{streamText}</pre>
          </details>
        )}

        <div className={styles.actions}>
          <Button onClick={onStop}>停止分析</Button>
        </div>
      </section>
    </div>
  );
}
