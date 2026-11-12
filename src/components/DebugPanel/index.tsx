import { useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Space, Tag, Timeline, Typography } from 'antd';
import { SendOutlined, StopOutlined } from '@ant-design/icons';

import { stopDebugRun } from '@/api/onexai';
import {
  approveDebug,
  askDebug,
  describeDebugError,
  type DebugEvent,
  type DebugInterrupt,
  type DebugStep,
  type DebugUsage,
} from '@/api/stream';

/**
 * 智能体调试面板：以管理员的身份跑一次这个智能体。
 *
 * # 两个身份，界面上也要能分开
 *
 * 这一次运行以该**智能体的归属者**作为执行主体（服务端决定，请求体里没有身份
 * 字段），而「谁按下了这次运行」是当前登录的管理员——后者记进审计。面板把两件事
 * 都写出来，因为它们不同，而看起来相同的地方最容易出问题。
 *
 * # 上游不返回工具的 result
 *
 * onexai 的 SSE 组装丢掉了它（`toProtoSteps()` 不填 `result`），所以步骤时间线只
 * 显示名称/状态/耗时/用量，`result` 显示「未返回」。这里**不编造**——一个看起来有
 * 内容的空字段比一个明说没有的字段危险得多。
 */
export default function DebugPanel({ agent }: { agent: string }) {
  const [question, setQuestion] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [answer, setAnswer] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [steps, setSteps] = useState<DebugStep[]>([]);
  const [usage, setUsage] = useState<DebugUsage | null>(null);
  const [interrupt, setInterrupt] = useState<DebugInterrupt | null>(null);
  const [runID, setRunID] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    setAnswer('');
    setReasoning('');
    setSteps([]);
    setUsage(null);
    setInterrupt(null);
    setError(null);
    setFinished(false);
  };

  /** 一个事件对状态的唯一一处作用。 */
  const apply = (event: DebugEvent) => {
    if (event.runID) setRunID(event.runID);
    switch (event.type) {
      case 'delta':
        // 推理流与回答分开累积：上游用同一个 delta 类型承载两者，靠 reasoning 区分。
        if (event.reasoning) setReasoning(prev => prev + event.text);
        else setAnswer(prev => prev + event.text);
        break;
      case 'step':
        setSteps(event.steps);
        break;
      case 'usage':
        setUsage(event.usage);
        break;
      case 'interrupt':
        setInterrupt(event.interrupt);
        break;
      case 'suspended':
        // 运行暂停了：这一段流结束，但 run 没结束——上面那个 interrupt 面板还在等一个
        // 答复。所以这里既不置 finished（会显示「已结束」），也不清 interrupt（会拿走
        // 界面上唯一还能做的动作）。
        break;
      case 'final':
        // 被停止时 text 是空的，含义是「没有更多内容」而不是「回答是空的」。直接覆盖
        // 会把模型已经说出的部分擦掉——一个停止按钮不该顺手删掉答案。
        if (event.text) setAnswer(event.text);
        if (event.usage) setUsage(event.usage);
        setFinished(true);
        setInterrupt(null);
        break;
      case 'error':
        setError(event.error);
        setFinished(true);
        break;
    }
  };

  const run = async (
    start: (options: { signal: AbortSignal; onEvent: (e: DebugEvent) => void }) => Promise<void>
  ) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setError(null);
    try {
      await start({ signal: controller.signal, onEvent: apply });
    } catch (err) {
      // 用户主动停止会走到这里（AbortError），不该表现为一次故障。
      if (!controller.signal.aborted) {
        setError(describeDebugError(err, '调试运行失败'));
      }
      setFinished(true);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleSend = () => {
    const text = question.trim();
    if (!text || streaming) return;
    reset();
    setQuestion('');
    void run(options => askDebug(agent, text, options));
  };

  const handleApprove = (
    decision: 'allow' | 'deny' | 'allow_all',
    answers?: Record<string, string>
  ) => {
    if (!runID || !interrupt) return;
    void run(options =>
      approveDebug({ runID, requestID: interrupt.requestID, decision, answers }, options)
    );
  };

  const handleStop = async () => {
    if (!runID) return;
    try {
      await stopDebugRun(runID);
    } catch (err) {
      setError(describeDebugError(err, '停止失败'));
    }
  };

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="这一次运行以智能体的归属者身份执行，不是以你的身份"
        description={
          <span>
            服务端按该智能体的 owner 组装运行主体（否则连它的授权门都过不去），而审计记录里
            留的是你——两个身份不同，服务端把它们分开记。这次运行不写会话、不写用量。
          </span>
        }
      />

      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onPressEnter={handleSend}
          placeholder="给它一个任务，回车发送"
          disabled={streaming}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={streaming || !question.trim()}
        >
          发送
        </Button>
        <Button icon={<StopOutlined />} onClick={handleStop} disabled={!streaming || !runID}>
          停止
        </Button>
      </Space.Compact>

      {error && <Alert type="error" showIcon style={{ marginTop: 16 }} title={error} />}

      {(reasoning || answer || steps.length > 0 || interrupt || usage) && (
        <Card size="small" style={{ marginTop: 16 }} title="运行过程">
          {steps.length > 0 && (
            <Timeline
              style={{ marginBottom: 16 }}
              items={steps.map((step, index) => ({
                key: step.id ?? `${step.name}-${index}`,
                color: step.status === 'ok' ? 'green' : step.status === 'fail' ? 'red' : 'blue',
                children: (
                  <Space direction="vertical" size={0}>
                    <Space size={6}>
                      <Typography.Text strong>{step.name}</Typography.Text>
                      <Tag>{step.status}</Tag>
                      {step.durationMs !== undefined && <span>{step.durationMs} ms</span>}
                      {step.tokens ? <span>{step.tokens} tokens</span> : null}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {step.result
                        ? `结果：${step.result}`
                        : step.status === 'pending'
                          ? '调用中'
                          : '结果：工具没有返回内容'}
                    </Typography.Text>
                  </Space>
                ),
              }))}
            />
          )}

          {reasoning && (
            <div style={{ marginBottom: 12 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                推理
              </Typography.Text>
              <Typography.Paragraph
                type="secondary"
                style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}
              >
                {reasoning}
              </Typography.Paragraph>
            </div>
          )}

          {answer && (
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{answer}</Typography.Paragraph>
          )}

          {interrupt && (
            <InterruptPanel interrupt={interrupt} disabled={streaming} onDecide={handleApprove} />
          )}

          {usage && (
            <Descriptions size="small" column={4} style={{ marginTop: 12 }}>
              <Descriptions.Item label="输入 tokens">{usage.promptTokens ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="输出 tokens">
                {usage.completionTokens ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="推理 tokens">
                {usage.reasoningTokens ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="调用次数">{usage.calls ?? '-'}</Descriptions.Item>
            </Descriptions>
          )}

          {finished && !interrupt && (
            <Typography.Text type={error ? 'danger' : 'success'}>
              {error ? '已结束（失败）' : '已结束'}
            </Typography.Text>
          )}
        </Card>
      )}
    </div>
  );
}

/**
 * 暂停面板：工具调用被拦（permission）或模型主动提问（question）。
 *
 * 两类在同一份数据结构里，只有 `kind` 不同，所以用同一个面板分两支渲染——把
 * 「问一句话」和「批准一个动作」做成两个面板，会让上游加第三类时没有一个显然的
 * 落点。
 */
function InterruptPanel({
  interrupt,
  disabled,
  onDecide,
}: {
  interrupt: DebugInterrupt;
  disabled: boolean;
  onDecide: (decision: 'allow' | 'deny' | 'allow_all', answers?: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questionKind = interrupt.requests.some(r => r.kind === 'question');

  return (
    <Card size="small" title="运行已暂停，等待你的决定" style={{ marginTop: 12 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {interrupt.requests.map(request => (
          <div key={request.address}>
            <Typography.Text strong>
              {request.kind === 'question' ? '提问' : '工具调用待批准'}
            </Typography.Text>
            {request.toolName && <Tag style={{ marginLeft: 8 }}>{request.toolName}</Tag>}
            <Typography.Paragraph style={{ marginBottom: 4 }}>
              {request.question || request.arguments}
            </Typography.Paragraph>
            {request.kind === 'question' && (
              <Input
                placeholder="你的回答"
                value={answers[request.address] ?? ''}
                onChange={e => setAnswers(prev => ({ ...prev, [request.address]: e.target.value }))}
                disabled={disabled}
              />
            )}
          </div>
        ))}

        <Space>
          {questionKind ? (
            <Button type="primary" disabled={disabled} onClick={() => onDecide('allow', answers)}>
              提交回答并继续
            </Button>
          ) : (
            <>
              <Button type="primary" disabled={disabled} onClick={() => onDecide('allow')}>
                批准
              </Button>
              <Button disabled={disabled} onClick={() => onDecide('allow_all')}>
                全部批准
              </Button>
            </>
          )}
          <Button danger disabled={disabled} onClick={() => onDecide('deny')}>
            拒绝
          </Button>
        </Space>
      </Space>
    </Card>
  );
}
