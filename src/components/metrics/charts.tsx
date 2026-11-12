import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  AriaComponent,
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';

/**
 * ECharts 按需注册。
 *
 * 只引入本抽屉用到的柱/折线与坐标轴组件；整个模块由 `components.tsx` 动态
 * import，所以 ECharts 不会进入 /agents 的首屏包。
 */
echarts.use([
  BarChart,
  LineChart,
  AriaComponent,
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export interface MonitorChartProps {
  option: EChartsCoreOption;
  height: number;
  ariaLabel?: string;
}

export default function MonitorChart({ option, height, ariaLabel }: MonitorChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;

    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    instance.current = chart;
    // 抽屉展开动画期间容器宽度可能为 0；ResizeObserver 会在尺寸稳定后补一次
    // resize，比在打开时 setTimeout 猜测时长可靠。
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);

    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    instance.current?.setOption(option, true);
  }, [option]);

  return (
    <div ref={container} role="img" aria-label={ariaLabel} style={{ width: '100%', height }} />
  );
}
