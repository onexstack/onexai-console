import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export { dayjs };

/**
 * 格式化日期
 * @param date - 日期
 * @param format - 格式化模板
 * @returns 格式化后的日期字符串
 */
export function formatDate(
  date: string | number | Date | dayjs.Dayjs,
  format = 'YYYY-MM-DD HH:mm:ss'
): string {
  return dayjs(date).format(format);
}

/**
 * 获取相对时间
 * @param date - 日期
 * @returns 相对时间字符串
 */
export function getRelativeTime(date: string | number | Date | dayjs.Dayjs): string {
  return dayjs(date).fromNow();
}

/**
 * 格式化一段耗时。
 *
 * 运行中的任务没有结束时间，用当前时间计算；组件会随轮询重渲染，所以这里
 * 不需要自己的定时器。空/非法开始时间显示 `-`。
 */
export function formatDurationMs(start?: number, end?: number): string {
  if (!start || start <= 0) return '-';
  const until = end && end > 0 ? end : Date.now();
  const millis = Math.max(0, until - start);
  if (millis < 1000) return `${millis}ms`;

  const seconds = millis / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * 判断是否是有效日期
 * @param date - 日期
 * @returns 是否有效
 */
export function isValidDate(date: unknown): boolean {
  return dayjs(date as string | number | Date).isValid();
}

/**
 * 获取日期范围
 * @param start - 开始日期
 * @param end - 结束日期
 * @returns 日期数组
 */
export function getDateRange(
  start: string | number | Date,
  end: string | number | Date
): dayjs.Dayjs[] {
  const dates: dayjs.Dayjs[] = [];
  let current = dayjs(start);
  const endDate = dayjs(end);

  while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
    dates.push(current);
    current = current.add(1, 'day');
  }

  return dates;
}
