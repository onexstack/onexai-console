import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/** 排班时区里的 dayjs 实例。 */
export function inZone(value: string | number | Date | dayjs.Dayjs, tz: string): dayjs.Dayjs {
  return dayjs(value).tz(safeZone(tz));
}

/** 某个自然日 00:00（排班时区）。 */
export function startOfDay(dayKey: string, tz: string): dayjs.Dayjs {
  return dayjs.tz(dayKey, safeZone(tz));
}

/** 排班时区里的日期键 YYYY-MM-DD。 */
export function dayKeyOf(value: string | number | Date | dayjs.Dayjs, tz: string): string {
  return inZone(value, tz).format('YYYY-MM-DD');
}

/** 时区名非法时退回 UTC，与服务端的求值器一致。 */
export function safeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    // Intl is the browser's authority on whether an IANA zone exists.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function formatInZone(value: string | undefined, tz: string, format = 'MM-DD HH:mm'): string {
  if (!value) return '-';
  return inZone(value, tz).format(format);
}

export function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return days === 1 ? '每天' : `${days} 天`;
  }
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  return `${seconds} 秒`;
}

export function rotationLabel(type: string, seconds: number): string {
  if (type === 'daily') return '每日轮转';
  if (type === 'weekly') return '每周轮转';
  return `每 ${formatDuration(seconds)} 轮转`;
}

/**
 * 从日历某一天生成默认 Override 窗口：排班时区当天 00:00 到次日 00:00。
 *
 * 必须按排班时区算，而不是浏览器时区——否则跨时区点击 11-07 可能得到 11-06
 * 23:00 开始的窗口，日历与实际生效范围就对不上了。
 */
export function defaultOverrideRange(dayKey: string, tz: string): [string, string] {
  const start = startOfDay(dayKey, safeZone(tz));
  return [start.toISOString(), start.add(1, 'day').toISOString()];
}

export { dayjs };
