import { useEffect } from 'react';
import { DatePicker, Form, Input } from 'antd';
import type { Dayjs } from 'dayjs';

import FormDrawer from './FormDrawer';
import { dayjs } from './time';

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (input: { date: string; name: string; countryCode?: string }) => Promise<void> | void;
}

interface FormValues {
  date: Dayjs;
  name: string;
  countryCode?: string;
}

/** 手工维护的节假日标记；V1 只是日历提示，不改变轮转数学。 */
export default function HolidayDrawer({ open, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ date: dayjs(), name: '', countryCode: '' });
  }, [open, form]);

  const submit = async () => {
    const values = await form.validateFields();
    await onSubmit({
      date: values.date.format('YYYY-MM-DD'),
      name: values.name.trim(),
      countryCode: values.countryCode?.trim() || undefined,
    });
  };

  return (
    <FormDrawer
      open={open}
      title="添加节假日"
      width={480}
      storageKey="oncall_holiday"
      onClose={onCancel}
      onSubmit={submit}
    >
      <Form form={form} layout="vertical">
        <Form.Item label="日期" name="date" rules={[{ required: true, message: '请选择日期' }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="国庆节 / Veterans Day" />
        </Form.Item>
        <Form.Item label="国家/地区代码" name="countryCode" extra="可留空；例如 CN、US。">
          <Input placeholder="CN" />
        </Form.Item>
      </Form>
    </FormDrawer>
  );
}
