import { useMemo } from 'react';

import type { AgentMonitorResponse } from '@/api/agentMonitor';
import { tokenTrendOption } from '../chartOptions';
import { ChartCard, ChartHost, EmptyBlock, KpiCard, SegmentedMeter } from '../components';
import {
  chartPalette,
  formatCompactNumber,
  formatFullNumber,
  formatRate,
  type ChartTheme,
} from '../format';
import styles from '../styles.module.scss';

export default function TokenSection({
  data,
  theme,
}: {
  data: AgentMonitorResponse;
  theme: ChartTheme;
}) {
  const tokens = data.summary.tokens;
  const palette = chartPalette(theme);
  const cacheTotal = tokens.cacheHitTokens + tokens.cacheMissTokens;
  const hasCacheSplit = cacheTotal > 0;
  const hasUsage = tokens.runsWithUsage > 0;

  const trendOption = useMemo(() => tokenTrendOption(data, theme), [data, theme]);

  const cacheSegments = [
    { key: 'hit', label: '缓存命中', value: tokens.cacheHitTokens, color: palette.success },
    { key: 'miss', label: '未命中', value: tokens.cacheMissTokens, color: palette.canceled },
  ];

  return (
    <>
      <div className={styles.kpiGrid}>
        <KpiCard
          label="总 Token"
          value={hasUsage ? formatCompactNumber(tokens.totalTokens) : '-'}
          title={hasUsage ? formatFullNumber(tokens.totalTokens) : undefined}
          hint="Prompt 与 Completion 之和；单次运行内多轮模型调用会累加。"
        />
        <KpiCard
          label="Prompt"
          value={hasUsage ? formatCompactNumber(tokens.promptTokens) : '-'}
          title={hasUsage ? formatFullNumber(tokens.promptTokens) : undefined}
        />
        <KpiCard
          label="Completion"
          value={hasUsage ? formatCompactNumber(tokens.completionTokens) : '-'}
          title={hasUsage ? formatFullNumber(tokens.completionTokens) : undefined}
        />
        <KpiCard
          label="模型调用"
          value={hasUsage ? formatFullNumber(tokens.calls) : '-'}
          hint="usage 中累计的模型调用次数，包含工具循环的每一轮。"
        />
        <KpiCard
          label="缓存命中率"
          value={hasCacheSplit ? formatRate(tokens.cacheHitRate, cacheTotal) : '-'}
          hint="缓存命中 token ÷（命中 + 未命中）。上游未上报拆分时显示 -。"
        />
        <KpiCard
          label="推理 Token"
          value={hasUsage ? formatCompactNumber(tokens.reasoningTokens) : '-'}
          title={hasUsage ? formatFullNumber(tokens.reasoningTokens) : undefined}
          hint="reasoning 模型单独上报的思考 token；普通模型为 0。"
        />
      </div>

      <div className={styles.chartGrid}>
        <ChartCard title="Token 趋势" hint="按时间桶堆叠 Prompt 与 Completion；柱高即总 Token。">
          {hasUsage ? (
            <ChartHost
              option={trendOption}
              height={260}
              ariaLabel="按时间分桶的 Prompt 与 Completion token 堆叠柱状图"
            />
          ) : (
            <EmptyBlock description="所选范围内没有上报 Token 用量的运行" />
          )}
        </ChartCard>

        <div className={styles.sideStack}>
          <ChartCard
            title="前缀缓存"
            hint="命中与未命中的 prompt token 拆分；写缓存的 token 不计入命中率。"
          >
            <SegmentedMeter segments={cacheSegments} emptyText="上游未上报缓存拆分" />
            <ul className={styles.meterLegend}>
              {cacheSegments.map(segment => (
                <li key={segment.key} className={styles.meterLegendItem}>
                  <span className={styles.legendDot} style={{ background: segment.color }} />
                  <span className={styles.legendLabel}>{segment.label}</span>
                  <span className={styles.legendValue}>
                    {formatCompactNumber(segment.value)}
                    {cacheTotal > 0 ? ` · ${((segment.value / cacheTotal) * 100).toFixed(1)}%` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {tokens.cacheWriteTokens > 0 ? (
              <p className={styles.note}>
                写缓存 {formatCompactNumber(tokens.cacheWriteTokens)} token
              </p>
            ) : null}
          </ChartCard>

          <ChartCard title="统计口径" hint="为什么有些数字显示为 -">
            <ul className={styles.noteList}>
              <li>只统计 usage JSON 可解析的运行，共 {tokens.runsWithUsage} 条。</li>
              <li>运行尚未结束或模型未上报 usage 时，token 不计入。</li>
              <li>缓存拆分缺失时，命中率显示 -，而不是 0%。</li>
            </ul>
          </ChartCard>
        </div>
      </div>
    </>
  );
}
