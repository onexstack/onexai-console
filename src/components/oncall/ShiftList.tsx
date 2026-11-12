import { Empty, List, Tag, Typography } from 'antd';

import type { TimelineSegment } from '@/api/types';
import { ScheduleUserName } from '@/components/UserRef';
import { formatInZone } from './time';

interface Props {
  segments: TimelineSegment[];
  timezone: string;
}

/** 移动端排班列表：未来窗口内的班次，替代横向过宽的日历。 */
export default function ShiftList({ segments, timezone }: Props) {
  if (!segments.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="窗口内没有排班" />;
  }
  return (
    <List
      size="small"
      dataSource={segments.slice(0, 30)}
      renderItem={segment => (
        <List.Item>
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <Typography.Text strong>
                <ScheduleUserName value={segment.userName} />
              </Typography.Text>
              {segment.isOverride ? <Tag color="purple">代班</Tag> : null}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatInZone(segment.start, timezone, 'MM-DD HH:mm')} →{' '}
              {formatInZone(segment.end, timezone, 'MM-DD HH:mm')}
              {segment.layerName ? ` · ${segment.layerName}` : ''}
            </Typography.Text>
          </div>
        </List.Item>
      )}
    />
  );
}
