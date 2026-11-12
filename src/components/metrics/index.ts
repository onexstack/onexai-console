/**
 * 监控/观测共用的图表、KPI、格式化与时间范围。
 *
 * 单智能体监控抽屉（`@/components/AgentMonitorDrawer`）与观测中心
 * （`@/pages/Observability`）消费同一份实现，避免两套指标口径漂移。
 */
export { default as MonitorChart } from './charts';
export {
  ChartCard,
  ChartHost,
  EmptyBlock,
  KpiCard,
  MeterLegend,
  RankBars,
  SegmentedMeter,
} from './components';
export {
  durationDistributionOption,
  durationTrendOption,
  failureRateOption,
  runTrendOption,
  slowRunRatio,
  tokenTrendOption,
} from './chartOptions';
export * from './format';
export * from './ranges';
export { default as SlowRunList } from './SlowRunList';
export { default as OverviewSection } from './sections/OverviewSection';
export { default as PerformanceSection } from './sections/PerformanceSection';
export { default as TokenSection } from './sections/TokenSection';
