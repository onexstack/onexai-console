import { useEffect, useState } from 'react';
import { Alert, App, Button, Collapse, Descriptions, Form, Space, Tag } from 'antd';
import type { FormInstance } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

import { previewA2ACard } from '@/api/agent';
import { buildA2AExecution } from '@/api/agentA2A';
import type { A2APreviewResult } from '@/api/types';

interface A2APreviewPanelProps {
  form: FormInstance;
  namespace: string;
}

/**
 * 外部 A2A 智能体的 AgentCard 预览。
 *
 * 预览是**提示性**的：拿到卡片、确认地址和鉴权能通，但不会阻塞提交。控制器的
 * 卡片同步（`status.a2a`）才是最终事实，页面上的状态页签会显示同步结果。
 */
export default function A2APreviewPanel({ form, namespace }: A2APreviewPanelProps) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<A2APreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const formName = Form.useWatch('name', form) as string | undefined;
  const formDisplayName = Form.useWatch('displayName', form) as string | undefined;

  // 影响卡片/鉴权的字段一变，旧预览立即作废（避免拿着旧结果提交新地址）。
  const signature = Form.useWatch(
    values =>
      JSON.stringify([
        values?.name,
        values?.displayName,
        values?.description,
        values?.execution?.a2a?.source,
        values?.execution?.a2a?.cardUrl,
        values?.execution?.a2a?.endpoint,
        values?.execution?.a2a?.runtimeRef,
        values?.execution?.a2a?.card,
        values?.execution?.a2a?.auth?.type,
        values?.execution?.a2a?.auth?.apiKeyHeader,
        values?.execution?.a2a?.auth?.credential,
        values?.execution?.a2a?.auth?.tokenUrl,
        values?.execution?.a2a?.auth?.clientId,
        values?.execution?.a2a?.auth?.clientSecret,
      ]),
    form
  );

  useEffect(() => {
    setPreview(null);
  }, [signature]);

  const runPreview = async () => {
    try {
      setPreviewing(true);
      const result = await previewA2ACard({
        namespace,
        kind: 'external',
        execution: buildA2AExecution(form.getFieldsValue(true) as Record<string, unknown>),
      });
      setPreview(result);
      if (!result.ok) message.error(result.message || '卡片获取失败');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '卡片获取失败');
    } finally {
      setPreviewing(false);
    }
  };

  const summary = preview?.summary;

  return (
    <>
      <Space style={{ marginTop: 12, marginBottom: 12 }}>
        <Button
          icon={<ThunderboltOutlined />}
          loading={previewing}
          onClick={() => void runPreview()}
        >
          获取并预览 AgentCard
        </Button>
        {preview?.ok && <Tag color="green">卡片有效 · {preview.latencyMs ?? 0}ms</Tag>}
        {preview && !preview.ok && <Tag color="red">获取失败</Tag>}
      </Space>

      {preview && (
        <Alert
          type={preview.ok ? 'success' : 'error'}
          showIcon
          title={preview.ok ? 'AgentCard 预览' : 'AgentCard 获取失败'}
          description={
            preview.ok ? (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Descriptions size="small" column={2} bordered>
                  <Descriptions.Item label="名称">
                    {formDisplayName || formName || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="协议">
                    {summary?.protocolVersion ?? '-'} / {summary?.transport ?? '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="版本">{summary?.cardVersion || '-'}</Descriptions.Item>
                  <Descriptions.Item label="卡片地址">
                    {preview.effectiveCardUrl || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="能力">
                    <Space size={4} wrap>
                      {summary?.capabilities?.streaming && <Tag>Streaming</Tag>}
                      {summary?.capabilities?.pushNotifications && <Tag>Push</Tag>}
                      {summary?.capabilities?.extendedAgentCard && <Tag>ExtendedCard</Tag>}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="技能">
                    {(summary?.skills?.length ?? 0) === 0
                      ? '-'
                      : summary?.skills?.map(skill => skill.name).join('、')}
                  </Descriptions.Item>
                </Descriptions>
                {preview.rawCard && (
                  <Collapse
                    size="small"
                    items={[
                      {
                        key: 'raw',
                        label: '查看原始 JSON',
                        children: (
                          <pre style={{ maxHeight: 320, overflow: 'auto', margin: 0 }}>
                            {prettify(preview.rawCard)}
                          </pre>
                        ),
                      },
                    ]}
                  />
                )}
              </Space>
            ) : (
              <span>{preview.message || '请检查地址与鉴权后重试'}</span>
            )
          }
        />
      )}
    </>
  );
}

function prettify(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
