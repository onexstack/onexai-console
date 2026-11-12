import { useEffect } from 'react';
import { DatePicker, Form } from 'antd';
import type { Dayjs } from 'dayjs';

import FormDrawer from './FormDrawer';
import UserPicker from '@/components/UserPicker';
import { dayjs } from './time';

interface Props {
  open: boolean;
  initialRange?: [string, string];
  onCancel: () => void;
  onSubmit: (input: { overrideUser: string; startTime: string; endTime: string }) => Promise<void> | void;
}

interface FormValues {
  overrideUser: string;
  range: [Dayjs, Dayjs];
}

/** 新建代班（override）抽屉。 */
export default function OverrideDrawer({ open, initialRange, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      overrideUser: '',
      range: initialRange
        ? [dayjs(initialRange[0]), dayjs(initialRange[1])]
        : [dayjs(), dayjs().add(1, 'day')],
    });
  }, [open, initialRange, form]);

  const submit = async () => {
    const values = await form.validateFields();
    await onSubmit({
      overrideUser: values.overrideUser.trim(),
      startTime: values.range[0].toISOString(),
      endTime: values.range[1].toISOString(),
    });
  };

  return (
    <FormDrawer
      open={open}
      title="新建代班 Override"
      storageKey="oncall_override"
      okText="创建"
      onClose={onCancel}
      onSubmit={submit}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="代班人"
          name="overrideUser"
          rules={[{ required: true, message: '请选择代班人' }]}
          extra="从平台用户中选择，或直接输入邮箱/姓名。创建后当前值班人与派单立即切换。"
        >
          <UserPicker />
        </Form.Item>
        <Form.Item label="时间窗口" name="range" rules={[{ required: true, message: '请选择时间窗口' }]}>
          <DatePicker.RangePicker showTime style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </FormDrawer>
  );
}
