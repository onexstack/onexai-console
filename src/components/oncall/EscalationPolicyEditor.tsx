import { useEffect } from 'react';
import { Button, Card, Empty, Form, InputNumber, Select, Space, Switch, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, PlusOutlined } from '@ant-design/icons';

import type { EscalationPolicy, EscalationTargetType, OncallCurrentResponse } from '@/api/types';
import DeleteIcon from '@/components/DeleteIcon';
import { ScheduleUserName } from '@/components/UserRef';
import UserPicker from '@/components/UserPicker';

interface TierForm {
  timeoutSeconds: number;
  targetType: EscalationTargetType;
  groupName?: string;
  userNames?: string[];
}

interface FormValues {
  enabled: boolean;
  autoEscalate: boolean;
  autoEscalateFromLevel: number;
  tiers: TierForm[];
}

interface Props {
  policy?: EscalationPolicy;
  groups: string[];
  /** 策略所属的值班组，用于“留空表示本组”时预览当前值班人。 */
  group: string;
  /** group -> 当前值班，来自 listCurrent()；未加载或失败时为空，预览静默降级。 */
  currentByGroup?: Map<string, OncallCurrentResponse>;
  saving?: boolean;
  onSave: (policy: EscalationPolicy) => Promise<void> | void;
}

const TARGET_OPTIONS = [
  { value: 'schedule', label: '当前排班的值班人' },
  { value: 'users', label: '指定人员' },
  { value: 'both', label: '排班值班人 + 指定人员' },
];

// 后端语义是 ticket.Level <= N 才自动启动（Level 1 最紧急），
// 所以 N=2 覆盖的是 P1、P2，而不是“P2 及以下”。
const LEVEL_OPTIONS = [
  { value: 0, label: '不限制' },
  { value: 1, label: '仅 P1' },
  { value: 2, label: 'P1–P2' },
  { value: 3, label: 'P1–P3' },
  { value: 4, label: 'P1–P4' },
];

/**
 * 升级策略编辑器。
 *
 * 层级按顺序执行：每一级通知后等待 timeout，无人确认（工单仍是 open）就进入下一级。
 * 确认语义由工单状态推断：processing / saved 视为已确认，resolved / closed 结束。
 */
export default function EscalationPolicyEditor({
  policy,
  groups,
  group,
  currentByGroup,
  saving,
  onSave,
}: Props) {
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    form.setFieldsValue({
      enabled: policy?.enabled ?? false,
      autoEscalate: policy?.autoEscalate ?? false,
      autoEscalateFromLevel: policy?.autoEscalateFromLevel ?? 0,
      tiers: policy?.tiers.map(tier => ({
        timeoutSeconds: tier.timeoutSeconds,
        targetType: tier.targetType,
        groupName: tier.groupName,
        userNames: tier.userNames ?? [],
      })) ?? [
        { timeoutSeconds: 300, targetType: 'schedule', groupName: '', userNames: [] },
        { timeoutSeconds: 600, targetType: 'users', groupName: '', userNames: [] },
      ],
    });
  }, [policy, form]);

  const submit = async () => {
    const values = await form.validateFields();
    await onSave({
      enabled: values.enabled,
      autoEscalate: values.autoEscalate,
      autoEscalateFromLevel: values.autoEscalateFromLevel,
      tiers: values.tiers.map((tier, index) => ({
        index,
        timeoutSeconds: tier.timeoutSeconds,
        targetType: tier.targetType,
        // users 目标不使用排班组；不把残留值写回，避免读接口看起来像“两地都配了”。
        groupName: tier.targetType === 'users' ? undefined : tier.groupName || undefined,
        userNames: tier.targetType === 'schedule' ? [] : (tier.userNames ?? []),
      })),
    });
  };

  const renderCurrentHint = (targetGroup?: string) => {
    if (!currentByGroup) return null;
    const resolved = (targetGroup || group || '').trim();
    if (!resolved) return null;
    const entry = currentByGroup.get(resolved);
    if (!entry) return null;
    const style = { fontSize: 12 };
    const member = entry.current;
    if (member) {
      return (
        <Typography.Text type="secondary" style={style}>
          当前值班：<ScheduleUserName value={member.userName} />
        </Typography.Text>
      );
    }
    if (entry.source === 'regen') {
      return (
        <Typography.Text type="secondary" style={style}>
          该组使用 Regen 旧排班
        </Typography.Text>
      );
    }
    if (entry.source === 'none') {
      return (
        <Typography.Text type="secondary" style={style}>
          该组无排班
        </Typography.Text>
      );
    }
    return (
      <Typography.Text type="secondary" style={style}>
        当前无人值班
      </Typography.Text>
    );
  };

  return (
    <Form form={form} layout="vertical">
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <Form.Item
            label="启用升级策略"
            name="enabled"
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Switch />
          </Form.Item>
          <Form.Item
            label="自动启动"
            name="autoEscalate"
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Switch />
          </Form.Item>
          <Form.Item label="自动启动的最高工单级别" style={{ marginBottom: 0 }}>
            <Space size={8} align="center">
              <Form.Item name="autoEscalateFromLevel" noStyle>
                <Select style={{ width: 140 }} options={LEVEL_OPTIONS} />
              </Form.Item>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                P1 最高；0 表示不按级别限制。
              </Typography.Text>
            </Space>
          </Form.Item>
        </Space>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
        >
          自动 worker 默认关闭；关闭时仍可在工单页手动点击「升级」，策略本身照常保存。
        </Typography.Paragraph>
      </Card>

      <Form.List name="tiers">
        {(fields, { add, remove, move }) => (
          <>
            {fields.length === 0 ? <Empty description="还没有升级层级" /> : null}
            {fields.map((field, index) => (
              <Card
                key={field.key}
                size="small"
                title={`第 ${index + 1} 级`}
                style={{ marginBottom: 12 }}
                extra={
                  <Space>
                    <Button
                      type="text"
                      icon={<ArrowUpOutlined />}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    />
                    <Button
                      type="text"
                      icon={<ArrowDownOutlined />}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, index + 1)}
                    />
                    <Button
                      type="text"
                      danger
                      icon={<DeleteIcon />}
                      onClick={() => remove(field.name)}
                    />
                  </Space>
                }
              >
                <Space align="start" wrap>
                  <Form.Item
                    label="等待时长（秒）"
                    name={[field.name, 'timeoutSeconds']}
                    rules={[{ required: true }]}
                    style={{ marginBottom: 12 }}
                  >
                    <InputNumber min={1} max={86400} style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item
                    label="通知对象"
                    name={[field.name, 'targetType']}
                    rules={[{ required: true }]}
                    style={{ marginBottom: 12, width: 240 }}
                  >
                    <Select options={TARGET_OPTIONS} />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate>
                    {() => {
                      const targetType = form.getFieldValue([
                        'tiers',
                        field.name,
                        'targetType',
                      ]) as EscalationTargetType | undefined;
                      const groupName = form.getFieldValue([
                        'tiers',
                        field.name,
                        'groupName',
                      ]) as string | undefined;
                      const needsUsers = targetType === 'users' || targetType === 'both';
                      return (
                        <>
                          {targetType === 'users' ? null : (
                            <Form.Item
                              label="指定排班组"
                              style={{ marginBottom: 12 }}
                              extra="留空表示本组；选择其他组时，升级给该组此刻的值班人。"
                            >
                              <Space size={8} align="center" wrap>
                                <Form.Item name={[field.name, 'groupName']} noStyle>
                                  <Select
                                    allowClear
                                    showSearch
                                    style={{ width: 200 }}
                                    placeholder="本组（默认）"
                                    options={groups.map(name => ({ value: name, label: name }))}
                                  />
                                </Form.Item>
                                {renderCurrentHint(groupName)}
                              </Space>
                            </Form.Item>
                          )}
                          {needsUsers ? (
                            <Form.Item
                              label="指定人员"
                              name={[field.name, 'userNames']}
                              style={{ marginBottom: 12, minWidth: 320, flex: 1 }}
                              extra="可从平台用户搜索，也可直接输入后回车。"
                              rules={[
                                {
                                  validator: (_rule, value) => {
                                    const list = Array.isArray(value)
                                      ? value.filter(Boolean)
                                      : [];
                                    return list.length
                                      ? Promise.resolve()
                                      : Promise.reject(
                                          new Error('“指定人员 / 两者”至少需要一名人员')
                                        );
                                  },
                                },
                              ]}
                            >
                              <UserPicker multiple />
                            </Form.Item>
                          ) : null}
                        </>
                      );
                    }}
                  </Form.Item>
                </Space>
              </Card>
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => add({ timeoutSeconds: 300, targetType: 'schedule', userNames: [] })}
            >
              添加层级
            </Button>
          </>
        )}
      </Form.List>

      <div style={{ marginTop: 16 }}>
        <Button type="primary" loading={saving} onClick={() => void submit()}>
          保存
        </Button>
      </div>
    </Form>
  );
}
