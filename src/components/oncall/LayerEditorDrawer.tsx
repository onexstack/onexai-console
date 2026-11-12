import { useEffect } from 'react';
import { Button, DatePicker, Form, Input, InputNumber, Select, Space, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, PlusOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';

import type { RotationType, ScheduleLayer } from '@/api/types';
import DeleteIcon from '@/components/DeleteIcon';
import FormDrawer from './FormDrawer';
import UserPicker from '@/components/UserPicker';
import { dayjs } from './time';

interface FormValues {
  name: string;
  rotationType: RotationType;
  rotationStart: Dayjs;
  durationValue: number;
  durationUnit: 'hours' | 'days';
  participants: { userName: string }[];
}

interface Props {
  open: boolean;
  layer?: ScheduleLayer;
  /** 当前排班里的所有参与者写法，用于选中时沿用既有形态。 */
  preferValues?: string[];
  onCancel: () => void;
  onSubmit: (layer: ScheduleLayer) => Promise<void> | void;
}

const ROTATION_OPTIONS = [
  { value: 'daily', label: '每日轮转（24 小时一班）' },
  { value: 'weekly', label: '每周轮转（7 天一班）' },
  { value: 'custom', label: '自定义时长' },
];

/** 一个轮转图层的编辑抽屉。参与者用上下移动排序，不引入拖拽库。 */
export default function LayerEditorDrawer({ open, layer, preferValues, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    if (!open) return;
    if (layer) {
      const seconds = layer.shiftDurationSeconds;
      const useDays = seconds % 86400 === 0;
      form.setFieldsValue({
        name: layer.name,
        rotationType: layer.rotationType,
        rotationStart: dayjs(layer.rotationStart),
        durationValue: useDays ? seconds / 86400 : seconds / 3600,
        durationUnit: useDays ? 'days' : 'hours',
        participants: layer.participants.map(p => ({ userName: p.userName })),
      });
      return;
    }
    form.setFieldsValue({
      name: 'Primary',
      rotationType: 'weekly',
      rotationStart: dayjs().startOf('day'),
      durationValue: 7,
      durationUnit: 'days',
      participants: [{ userName: '' }],
    });
  }, [open, layer, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const seconds =
      values.durationUnit === 'days'
        ? Math.round(values.durationValue * 86400)
        : Math.round(values.durationValue * 3600);
    const result: ScheduleLayer = {
      name: values.name.trim(),
      orderIndex: layer?.orderIndex ?? 0,
      rotationType: values.rotationType,
      rotationStart: values.rotationStart.toISOString(),
      shiftDurationSeconds: seconds,
      participants: values.participants
        .map((p, index) => ({ userName: p.userName.trim(), orderIndex: index }))
        .filter(p => p.userName !== ''),
    };
    await onSubmit(result);
  };

  return (
    <FormDrawer
      open={open}
      title={layer ? '编辑轮转图层' : '新增轮转图层'}
      width={640}
      storageKey="oncall_layer"
      onClose={onCancel}
      onSubmit={submit}
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={changed => {
          if (changed.rotationType === 'daily') {
            form.setFieldsValue({ durationValue: 1, durationUnit: 'days' });
          } else if (changed.rotationType === 'weekly') {
            form.setFieldsValue({ durationValue: 7, durationUnit: 'days' });
          }
        }}
      >
        <Form.Item
          name="name"
          label="图层名称"
          rules={[{ required: true, message: '请输入图层名称' }]}
        >
          <Input placeholder="Primary / Backup" />
        </Form.Item>

        <Space align="start" style={{ width: '100%' }} wrap>
          <Form.Item
            name="rotationType"
            label="轮转类型"
            rules={[{ required: true }]}
            style={{ width: 220 }}
          >
            <Select options={ROTATION_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="rotationStart"
            label="轮转起点"
            rules={[{ required: true, message: '请选择起点' }]}
          >
            <DatePicker showTime style={{ width: 240 }} />
          </Form.Item>
        </Space>

        <Space align="start">
          <Form.Item name="durationValue" label="班次时长" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="durationUnit" label="单位">
            <Select
              style={{ width: 100 }}
              options={[
                { value: 'days', label: '天' },
                { value: 'hours', label: '小时' },
              ]}
            />
          </Form.Item>
        </Space>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
          班次边界从轮转起点按绝对时长推进，跨夏令时不会漂移；不可用与节假日按排班时区的自然日。
        </Typography.Paragraph>

        <Form.List name="participants">
          {(fields, { add, remove, move }) => (
            <div style={{ marginTop: 12 }}>
              <Typography.Text strong>参与者（按顺序轮转）</Typography.Text>
              {fields.map((field, index) => (
                <Space key={field.key} align="baseline" style={{ display: 'flex', marginTop: 8 }}>
                  <Typography.Text type="secondary" style={{ width: 24 }}>
                    {index + 1}
                  </Typography.Text>
                  <Form.Item
                    {...field}
                    name={[field.name, 'userName']}
                    rules={[{ required: true, message: '请输入值班人' }]}
                    style={{ marginBottom: 0, width: 320 }}
                  >
                    <UserPicker preferValues={preferValues} />
                  </Form.Item>
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
                    disabled={fields.length <= 1}
                    onClick={() => remove(field.name)}
                  />
                </Space>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add({ userName: '' })}
                style={{ marginTop: 12 }}
              >
                添加参与者
              </Button>
            </div>
          )}
        </Form.List>
      </Form>
    </FormDrawer>
  );
}
