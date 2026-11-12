import { useState } from 'react';
import { App, Button, Space } from 'antd';

import { ResizableDrawer } from '@/ui';

export interface FormDrawerProps {
  open: boolean;
  title: string;
  /** 桌面端默认宽度（用户拖拽后以记忆值为准）；移动端固定占满整屏。 */
  width?: number;
  /** 记住用户拖出来的宽度；不同表单传不同 key。 */
  storageKey?: string;
  okText?: string;
  cancelText?: string;
  /** 关闭抽屉。保存请求在途时会被忽略。 */
  onClose: () => void;
  /** 校验并提交。抛错会提示并保持抽屉打开。 */
  onSubmit: () => Promise<void> | void;
  children: React.ReactNode;
}

/**
 * 值班页的表单抽屉：从右侧滑出，取消/保存放在头部右侧。
 *
 * 头部不随内容滚动，参与者列表变长时「保存」仍然可见。保存请求在途时禁止
 * 关闭，避免用户以为已经取消。
 */
export default function FormDrawer({
  open,
  title,
  width = 560,
  storageKey,
  okText = '保存',
  cancelText = '取消',
  onClose,
  onSubmit,
  children,
}: FormDrawerProps) {
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit();
    } catch (err) {
      // 校验失败时 antd 会 reject 一个带 errorFields 的对象：字段下方已经
      // 标红，不再额外弹全局提示。
      if (isValidationError(err)) return;
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResizableDrawer
      open={open}
      title={title}
      onClose={close}
      defaultWidth={width}
      storageKey={storageKey}
      destroyOnHidden
      maskClosable={!submitting}
      keyboard={!submitting}
      closable={!submitting}
      extra={
        <Space>
          <Button onClick={close} disabled={submitting}>
            {cancelText}
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void submit()}>
            {okText}
          </Button>
        </Space>
      }
    >
      {children}
    </ResizableDrawer>
  );
}

function isValidationError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'errorFields' in err;
}
