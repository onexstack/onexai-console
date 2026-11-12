import { useState } from 'react';
import { Button, Input, Select, Space } from 'antd';

import type { ApproveDecision, DebugInterrupt } from '@/api/stream';

import type { ApprovalExtra } from './types';
import styles from './bubble.module.scss';

/** 工具审批 / 模型提问。流式在 interrupt 处暂停，等待这里给出答复后继续。 */
export function ApprovalCard({
  interrupt,
  disabled,
  onApprove,
}: {
  interrupt: DebugInterrupt;
  disabled?: boolean;
  onApprove: (decision: ApproveDecision, extra?: ApprovalExtra) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = interrupt.requests.filter(request => request.kind === 'question');
  const permissions = interrupt.requests.filter(request => request.kind !== 'question');

  return (
    <div className={styles.approval} role="group" aria-label="等待确认">
      <div className={styles.approvalTitle}>等待你的确认</div>

      {permissions.map(request => (
        <div key={request.address || request.toolName} className={styles.approvalItem}>
          <div>
            工具 <code>{request.toolName}</code> 请求执行
          </div>
          {request.arguments && <pre className={styles.approvalArgs}>{request.arguments}</pre>}
        </div>
      ))}

      {questions.map(request => (
        <div key={request.address} className={styles.approvalItem}>
          <div className={styles.approvalQuestion}>{request.question || request.toolName}</div>
          {request.options.length > 0 ? (
            <Select
              style={{ width: '100%' }}
              placeholder="选择一项"
              value={answers[request.address]}
              onChange={value => setAnswers(prev => ({ ...prev, [request.address]: value }))}
              options={request.options.map(option => ({ value: option, label: option }))}
            />
          ) : (
            <Input
              value={answers[request.address] ?? ''}
              onChange={event =>
                setAnswers(prev => ({ ...prev, [request.address]: event.target.value }))
              }
            />
          )}
        </div>
      ))}

      <Space wrap>
        {questions.length > 0 ? (
          <Button
            type="primary"
            disabled={disabled}
            onClick={() => onApprove('allow', { answers })}
          >
            提交回答
          </Button>
        ) : (
          <>
            <Button type="primary" disabled={disabled} onClick={() => onApprove('allow')}>
              允许
            </Button>
            <Button danger disabled={disabled} onClick={() => onApprove('deny')}>
              拒绝
            </Button>
            <Button disabled={disabled} onClick={() => onApprove('allow_all')}>
              全部允许
            </Button>
          </>
        )}
      </Space>
    </div>
  );
}
