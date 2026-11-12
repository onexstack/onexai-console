import { lazy, Suspense, type ReactNode } from 'react';
import { Empty, Skeleton } from 'antd';
import type { EChartsCoreOption } from 'echarts/core';

import { FieldHint } from '@/ui/components/FieldHint';
import styles from './styles.module.scss';

/**
 * 监控/观测共用的展示件。
 *
 * 图表模块单独 lazy import：ECharts 只在第一次画图时加载；抽屉关闭后
 * `destroyOnHidden` 与图表自身的 dispose 一起释放实例。
 */
const LazyMonitorChart = lazy(() => import('./charts'));

export function ChartHost({
  option,
  height,
  ariaLabel,
}: {
  option: EChartsCoreOption;
  height: number;
  ariaLabel: string;
}) {
  return (
    <Suspense
      fallback={
        <Skeleton.Node active style={{ width: '100%', height }}>
          <span />
        </Skeleton.Node>
      }
    >
      <LazyMonitorChart option={option} height={height} ariaLabel={ariaLabel} />
    </Suspense>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  suffix,
  title,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  suffix?: ReactNode;
  /** 完整数值（缩写值放不下时用浏览器原生提示补齐）。 */
  title?: string;
}) {
  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiLabel}>
        <span>{label}</span>
        <FieldHint>{hint}</FieldHint>
      </div>
      <div className={styles.kpiValue} title={title}>
        {value}
        {suffix ? <span className={styles.kpiSuffix}>{suffix}</span> : null}
      </div>
    </div>
  );
}

export function ChartCard({
  title,
  hint,
  extra,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.chartCard}>
      <div className={styles.chartCardHead}>
        <div className={styles.chartCardTitle}>
          <span>{title}</span>
          <FieldHint>{hint}</FieldHint>
        </div>
        {extra ? <div>{extra}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function SegmentedMeter({
  segments,
  emptyText = '暂无数据',
}: {
  segments: { key: string; label: string; value: number; color: string }[];
  emptyText?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) {
    return <div className={styles.meterEmpty}>{emptyText}</div>;
  }
  return (
    <div
      className={styles.meterTrack}
      role="img"
      aria-label={segments.map(s => `${s.label} ${s.value}`).join('，')}
    >
      {segments
        .filter(segment => segment.value > 0)
        .map(segment => (
          <span
            key={segment.key}
            className={styles.meterSegment}
            style={{ flexGrow: segment.value, background: segment.color }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
    </div>
  );
}

export function MeterLegend({
  segments,
  total,
}: {
  segments: { key: string; label: string; value: number; color: string }[];
  total: number;
}) {
  return (
    <ul className={styles.meterLegend}>
      {segments.map(segment => (
        <li key={segment.key} className={styles.meterLegendItem}>
          <span className={styles.legendDot} style={{ background: segment.color }} />
          <span className={styles.legendLabel}>{segment.label}</span>
          <span className={styles.legendValue}>
            {segment.value}
            {total > 0 ? ` · ${((segment.value / total) * 100).toFixed(1)}%` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RankBars({
  items,
  emptyText = '暂无数据',
}: {
  items: { key: string; label: string; value: number }[];
  emptyText?: string;
}) {
  const max = items.reduce((value, item) => Math.max(value, item.value), 0);
  if (!items.length || max <= 0) {
    return <div className={styles.meterEmpty}>{emptyText}</div>;
  }
  return (
    <ul className={styles.rankList}>
      {items.map(item => (
        <li key={item.key} className={styles.rankItem}>
          <span className={styles.rankLabel} title={item.label}>
            {item.label}
          </span>
          <span className={styles.rankTrack}>
            <span
              className={styles.rankBar}
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </span>
          <span className={styles.rankValue}>{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function EmptyBlock({ description }: { description: ReactNode }) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={description}
      className={styles.emptyBlock}
    />
  );
}
