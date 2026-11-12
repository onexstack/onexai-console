import { Alert, Card, Empty, Space, Tag, Typography } from 'antd';
import { PhoneOutlined } from '@ant-design/icons';

import type { OncallCurrentResponse } from '@/api/types';
import { ScheduleUserName } from '@/components/UserRef';
import { formatInZone } from './time';

interface Props {
  current?: OncallCurrentResponse;
  timezone: string;
  loading?: boolean;
}

/** 当前值班卡片：主值班 + 备班 + 交接时间。 */
export default function CurrentOnCallCard({ current, timezone, loading }: Props) {
  const member = current?.current;

  return (
    <Card
      size="small"
      loading={loading}
      title={
        <Space>
          <PhoneOutlined />
          <span>当前值班</span>
          {member?.isOverride ? <Tag color="purple">代班</Tag> : null}
        </Space>
      }
      extra={
        current?.source === 'regen' ? (
          <Tag color="orange">Regen 旧排班</Tag>
        ) : current?.source === 'none' ? (
          <Tag>未配置</Tag>
        ) : (
          <Tag color="green">原生排班</Tag>
        )
      }
    >
      {member ? (
        <>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <ScheduleUserName value={member.userName} />
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {member.layerName ? `${member.layerName} · ` : ''}
            {member.until ? `至 ${formatInZone(member.until, timezone, 'MM-DD HH:mm')}` : '交接时间未知'}
          </Typography.Text>
          {current?.backups?.length ? (
            <div style={{ marginTop: 12 }}>
              <Typography.Text strong style={{ fontSize: 12 }}>
                备班
              </Typography.Text>
              <div style={{ marginTop: 4 }}>
                <Space wrap>
                  {current.backups.map(backup => (
                    <Tag key={backup.userName}>
                      <ScheduleUserName value={backup.userName} />
                      {backup.until ? `（至 ${formatInZone(backup.until, timezone, 'MM-DD HH:mm')}）` : ''}
                    </Tag>
                  ))}
                </Space>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            current?.source === 'regen'
              ? '该组仍使用 Regen 排班；导入原生排班后这里会显示实时值班人。'
              : '当前没有值班人，请检查轮转图层与不可用设置。'
          }
        >
          {current?.source === 'regen' ? (
            <Alert
              type="info"
              showIcon
              message="尚未迁移到原生排班"
              style={{ textAlign: 'left' }}
            />
          ) : null}
        </Empty>
      )}
    </Card>
  );
}
