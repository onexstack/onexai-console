/**
 * 时区候选与默认值。
 *
 * 定时任务的 cron 必须和时区一起解读：`0 9 * * *` 在 Asia/Shanghai 和 UTC
 * 下差 8 小时。界面因此把时区做成显式字段，并默认取用户本机时区——不让人
 * 因为「没填」而无意中按 UTC 排班。
 *
 * 候选来自运行环境（`Intl.supportedValuesOf`），不维护一份会过期的时区表；
 * 老浏览器没有这个 API 时退回常用时区，至少覆盖绝大多数部署场景。
 */

const FALLBACK_ZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
] as const;

/** 当前浏览器所在时区；取不到时按本地部署最常用的 Asia/Shanghai 兜底。 */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

let cachedZones: string[] | undefined;
let cachedOptions: TimeZoneOption[] | undefined;

/** 一个下拉候选。 */
export interface TimeZoneOption {
  value: string;
  label: string;
}

/** 当前时刻的 UTC 偏移（如 `UTC+08:00`）；算不出来时返回空串。 */
export function timeZoneOffsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    const name = parts.find(part => part.type === 'timeZoneName')?.value ?? '';
    return name.replace(/^GMT/, 'UTC');
  } catch {
    return '';
  }
}

/**
 * 全部可选时区（IANA 名称），按字母序返回。
 *
 * 结果在模块内缓存：候选表不会随会话变化，而列表有多达数百项。
 */
export function timeZoneNames(): string[] {
  if (cachedZones) return cachedZones;

  let supported: string[] = [];
  try {
    supported = Intl.supportedValuesOf('timeZone');
  } catch {
    supported = [];
  }

  const names = new Set<string>([...FALLBACK_ZONES, ...supported, localTimeZone()]);
  // 按 IANA 名称的码位排序，避免不同语言环境下顺序漂移。
  cachedZones = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return cachedZones;
}

/**
 * 下拉候选：名称 + 当前 UTC 偏移，例如 `Asia/Shanghai（UTC+08:00）`。
 *
 * 偏移按「现在」计算，只用于帮助识别时区；实际执行由服务端按 IANA 名称解释，
 * 夏令时切换不受影响。整张表只构建一次。
 */
export function timeZoneOptions(): TimeZoneOption[] {
  if (cachedOptions) return cachedOptions;
  cachedOptions = timeZoneNames().map(zone => ({
    value: zone,
    label: timeZoneLabel(zone),
  }));
  return cachedOptions;
}

/** `Asia/Shanghai（UTC+08:00）`；UTC 自身不重复画偏移。 */
export function timeZoneLabel(zone: string): string {
  if (zone === 'UTC') return zone;
  const offset = timeZoneOffsetLabel(zone);
  return offset && offset !== 'UTC' ? `${zone}（${offset}）` : zone;
}
