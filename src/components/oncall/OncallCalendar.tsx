import { Button, Space, Tag, Tooltip, Typography } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';

import type { ScheduleHoliday, TimelineSegment } from '@/api/types';
import { useUserDirectory } from '@/components/UserRef';
import { dayjs, inZone, safeZone, startOfDay } from './time';

export interface CalendarRow {
  key: string;
  label: string;
  segments: TimelineSegment[];
}

interface Props {
  timezone: string;
  /** 窗口起点（排班时区的某一天）。 */
  windowStart: string;
  days: number;
  /** 左右切换的步长：月视图按月，周视图按周。 */
  stepUnit?: 'day' | 'month';
  rows: CalendarRow[];
  holidays: ScheduleHoliday[];
  onNavigate: (delta: number, unit: 'day' | 'month') => void;
  onToday: () => void;
  onDayClick?: (dayKey: string) => void;
}

interface Span {
  key: string;
  /** 排班里实际写入的值，用于判断相邻格子是否同人。 */
  rawUser: string;
  /** 展示名（飞书名 / 平台名）。 */
  user: string;
  start: number;
  end: number;
  isOverride: boolean;
}

/**
 * 值班日历（CSS Grid Gantt，无第三方日历依赖）。
 *
 * 一天一格；相邻且同人（且 override 标记相同）的格子合并成一条。override 用
 * 紫色描边区分。所有分桶都按排班时区，不用浏览器时区——否则跨时区看起来会
 * 在错误的日期交接。
 */
export default function OncallCalendar({
  timezone,
  windowStart,
  days,
  stepUnit = 'month',
  rows,
  holidays,
  onNavigate,
  onToday,
  onDayClick,
}: Props) {
  const { resolveName } = useUserDirectory();
  const tz = safeZone(timezone);
  const start = startOfDay(windowStart, tz);
  const dayKeys = Array.from({ length: days }, (_, i) => start.add(i, 'day').format('YYYY-MM-DD'));
  const holidayByDay = new Map(holidays.map(h => [h.date, h]));
  const todayKey = dayjs().tz(tz).format('YYYY-MM-DD');
  const dayWidth = 22;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Space>
          <Button size="small" icon={<LeftOutlined />} onClick={() => onNavigate(-1, stepUnit)} />
          <Typography.Text strong>
            {stepUnit === 'month' ? start.format('YYYY 年 MM 月') : `${start.format('MM-DD')} 起一周`}
          </Typography.Text>
          <Button size="small" icon={<RightOutlined />} onClick={() => onNavigate(1, stepUnit)} />
          <Button size="small" onClick={onToday}>
            今天
          </Button>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {tz} · 当前 {dayjs().tz(tz).format('MM-DD HH:mm')}
        </Typography.Text>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 160 + days * dayWidth }}>
          <div style={{ display: 'flex', marginBottom: 4 }}>
            <div style={{ width: 160, flex: '0 0 160px' }} />
            <div
              style={{
                flex: 1,
                display: 'grid',
                gridTemplateColumns: `repeat(${days}, minmax(${dayWidth}px, 1fr))`,
              }}
            >
              {dayKeys.map(key => {
                const holiday = holidayByDay.get(key);
                const isToday = key === todayKey;
                return (
                  <Tooltip key={key} title={holiday ? `节假日：${holiday.name}` : undefined}>
                    <div
                      style={{
                        textAlign: 'center',
                        fontSize: 11,
                        color: isToday ? '#cf1322' : 'var(--color-text-tertiary)',
                        fontWeight: isToday ? 600 : 400,
                        padding: '2px 0',
                      }}
                    >
                      {dayjs.tz(key, tz).format('DD')}
                      {holiday ? ' 🎉' : ''}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          {rows.map(row => (
            <div key={row.key} style={{ display: 'flex', marginBottom: 6 }}>
              <div
                style={{
                  width: 160,
                  flex: '0 0 160px',
                  paddingRight: 12,
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.label}
              </div>
              <div
                style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${days}, minmax(${dayWidth}px, 1fr))`,
                  gap: 2,
                }}
              >
                {spansOf(row.segments, dayKeys, tz, resolveName).map(span => (
                  <div
                    key={span.key}
                    onClick={() => onDayClick?.(dayKeys[span.start] ?? '')}
                    style={{
                      gridColumn: `${span.start + 1} / ${span.end + 2}`,
                      background: span.isOverride ? '#f9f0ff' : '#e6f4ff',
                      border: span.isOverride ? '1px solid #722ed1' : '1px solid #91caff',
                      borderRadius: 4,
                      padding: '4px 6px',
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      cursor: onDayClick ? 'pointer' : 'default',
                    }}
                  >
                    {span.user}
                    {span.isOverride ? (
                      <Tag bordered={false} color="purple" style={{ marginInlineStart: 6, fontSize: 10 }}>
                        代班
                      </Tag>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function spansOf(
  segments: TimelineSegment[],
  dayKeys: string[],
  tz: string,
  displayName: (value: string) => string
): Span[] {
  const owners = dayKeys.map((key, index) => {
    const dayStart = startOfDay(key, tz);
    const dayEnd = dayStart.add(1, 'day');
    const segment = segments.find(s => inZone(s.start, tz).isBefore(dayEnd) && inZone(s.end, tz).isAfter(dayStart));
    return {
      index,
      rawUser: segment?.userName ?? '-',
      isOverride: Boolean(segment?.isOverride),
    };
  });

  const spans: Span[] = [];
  for (const owner of owners) {
    const last = spans[spans.length - 1];
    // 合并按原始值判断：两个不同账号即使展示名相同，也不能并成一格。
    if (last && last.rawUser === owner.rawUser && last.isOverride === owner.isOverride) {
      last.end = owner.index;
      continue;
    }
    spans.push({
      key: `${owner.index}-${owner.rawUser}`,
      rawUser: owner.rawUser,
      user: displayName(owner.rawUser),
      start: owner.index,
      end: owner.index,
      isOverride: owner.isOverride,
    });
  }
  return spans;
}
