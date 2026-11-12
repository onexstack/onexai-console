import { useEffect } from 'react';
import { DatePicker, Form, Input } from 'antd';
import type { Dayjs } from 'dayjs';

import FormDrawer from './FormDrawer';
import UserPicker from '@/components/UserPicker';
import { dayjs } from './time';

interface Props {
  open: boolean;
  users: string[];
  onCancel: () => void;
  onSubmit: (input: { userName: string; startDate: string; endDate: string; reason?: string }) => Promise<void> | void;
}

interface FormValues {
  userName: string;
  range: [Dayjs, Dayjs];
  reason?: string;
}

/** 标记某人在整段时间不可用；不可用的值班人会在同班次顺延。 */
export default function AvailabilityDrawer({ open, users, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      userName: users[0] ?? '',
      range: [dayjs(), dayjs()],
      reason: '',
    });
  }, [open, users, form]);

  const submit = async () => {
    const values = await form.validateFields();
    await onSubmit({
      userName: values.userName.trim(),
      startDate: values.range[0].format('YYYY-MM-DD'),
      endDate: values.range[1].format('YYYY-MM-DD'),
      reason: values.reason?.trim(),
    });
  };

  return (
    <FormDrawer
      open={open}
      title="标记不可用"
      storageKey="oncall_availability"
      onClose={onCancel}
      onSubmit={submit}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="值班人"
          name="userName"
          rules={[{ required: true, message: '请选择值班人' }]}
          extra={users.length ? `排班中的参与者：${users.join('、')}` : undefined}
        >
          <UserPicker preferValues={users} />
        </Form.Item>
        <Form.Item label="日期范围（含首尾）" name="range" rules={[{ required: true, message: '请选择日期' }]}>
          <DatePicker.RangePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="原因" name="reason">
          <Input.TextArea rows={2} placeholder="PTO / 出差 / 培训" />
        </Form.Item>
      </Form>
    </FormDrawer>
  );
}
