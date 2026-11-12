import { Alert, Card, Descriptions, Space, Tag } from 'antd';

import type { OncallGroup, OncallScheduleResponse } from '@/api/types';
import { StatusSwitch } from '@/ui';

interface Props {
  group: OncallGroup;
  schedule?: OncallScheduleResponse;
}

/** 值班组头部摘要：元数据 + 排班来源。 */
export default function GroupSummary({ group, schedule }: Props) {
  const source = schedule?.source ?? 'none';

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
        <Descriptions.Item label="显示名">{group.displayName || group.name}</Descriptions.Item>
        <Descriptions.Item label="负责人">{group.owner || '-'}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <StatusSwitch
            checked={group.status !== 'disabled'}
            onLabel="启用"
            offLabel="已停用"
            disabled
          />
        </Descriptions.Item>
        <Descriptions.Item label="时区">{schedule?.schedule?.timezone || '-'}</Descriptions.Item>
        <Descriptions.Item label="分配策略">{group.allocationStrategy || 'primary'}</Descriptions.Item>
        <Descriptions.Item label="关联智能体">{group.agents || '-'}</Descriptions.Item>
        <Descriptions.Item label="排班来源">
          {source === 'native' ? (
            <Tag color="green">原生排班</Tag>
          ) : source === 'regen' ? (
            <Tag color="orange">Regen 旧排班</Tag>
          ) : (
            <Tag>未配置</Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="轮转图层" span={2}>
          <Space wrap>
            {(schedule?.schedule?.layers ?? []).map(layer => (
              <Tag key={layer.name}>
                {layer.name} · {layer.participants.length} 人
              </Tag>
            ))}
            {!schedule?.schedule?.layers?.length ? '-' : null}
          </Space>
        </Descriptions.Item>
      </Descriptions>
      {source === 'regen' ? (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message="该组仍在读取 Regen 的排班"
          description={`旧排班 ID：${schedule?.legacyScheduleId || '-'}。在「轮转图层」保存原生排班后，原生排班优先生效；也可以先用 hack/regen-import 导入。`}
        />
      ) : null}
    </Card>
  );
}
