import { useRef, useState } from 'react';
import { Alert, App, Button, Empty, Input, Space, Tag, Typography } from 'antd';
import { SendOutlined, StopOutlined } from '@ant-design/icons';

import { cancelA2ATask, streamA2A, type A2AStreamEvent } from '@/api/a2a';

type Message = { role: 'user' | 'assistant'; text: string };
type Artifact = NonNullable<A2AStreamEvent['artifact']>;

/** 详情页里的 A2A 在线调试：文本消息 + 流式状态/工件。 */
export function A2ADebugPanel({ name }: { name: string }) {
  const { message } = App.useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState('');
  const [taskId, setTaskId] = useState('');
  const [contextId, setContextId] = useState('');
  const [invocationId, setInvocationId] = useState('');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [interrupt, setInterrupt] = useState<{ kind?: string; message?: string } | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const appendAssistant = (text: string) => {
    if (!text) return;
    setMessages(prev => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: last.text + text };
      else next.push({ role: 'assistant', text });
      return next;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    setInterrupt(null);
    setBusy(true);
    setMessages(prev => [...prev, { role: 'user', text }, { role: 'assistant', text: '' }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamA2A(
        name,
        {
          message: text,
          contextId: contextId || undefined,
          taskId: interrupt ? taskId || undefined : undefined,
        },
        {
          signal: controller.signal,
          onEvent: event => {
            switch (event.type) {
              case 'invocation':
                setInvocationId(event.invocationId ?? '');
                break;
              case 'status':
                setState(event.state ?? '');
                if (event.taskId) setTaskId(event.taskId);
                if (event.contextId) setContextId(event.contextId);
                if (event.message) appendAssistant(event.message);
                break;
              case 'delta':
                appendAssistant(event.text ?? '');
                break;
              case 'artifact':
                if (event.artifact) setArtifacts(prev => [...prev, event.artifact as Artifact]);
                break;
              case 'interrupt':
                setState(event.state ?? 'input-required');
                setInterrupt({ kind: event.state, message: event.message });
                break;
              case 'error':
                setError(event.message ?? '调用失败');
                break;
              case 'done':
                setBusy(false);
                break;
              default:
                break;
            }
          },
        }
      );
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : '调用失败');
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = async () => {
    abortRef.current?.abort();
    if (taskId) {
      try {
        await cancelA2ATask(name, taskId);
        message.success('已请求取消远端任务');
      } catch {
        message.warning('本地已停止；远端取消失败');
      }
    }
    setBusy(false);
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setTaskId('');
    setContextId('');
    setInvocationId('');
    setArtifacts([]);
    setInterrupt(null);
    setError('');
    setState('');
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Tag>状态 {state || '-'}</Tag>
        {taskId && <Tag>task {taskId}</Tag>}
        {contextId && <Tag>context {contextId}</Tag>}
        {invocationId && <Tag>invocation {invocationId}</Tag>}
        <Button size="small" onClick={reset} disabled={busy}>
          新会话
        </Button>
      </Space>

      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: 12,
          minHeight: 240,
          maxHeight: 420,
          overflow: 'auto',
          background: 'var(--color-bg-container)',
        }}
      >
        {messages.length === 0 ? (
          <Empty description="发送一条消息开始调试" />
        ) : (
          messages.map((item, index) => (
            <div key={`${item.role}-${index}`} style={{ marginBottom: 12 }}>
              <Typography.Text strong>{item.role === 'user' ? '你' : 'Agent'}</Typography.Text>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{item.text || '…'}</div>
            </div>
          ))
        )}
        {error && <Alert type="error" showIcon title="调用失败" description={error} />}
        {interrupt && (
          <Alert
            type="warning"
            showIcon
            title={interrupt.kind === 'auth-required' ? '远端需要鉴权' : '远端需要补充输入'}
            description={interrupt.message || '请输入后继续'}
          />
        )}
      </div>

      {artifacts.length > 0 && (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text strong>工件</Typography.Text>
          {artifacts.map((artifact, index) => (
            <pre
              key={`${artifact.artifactId}-${index}`}
              style={{ margin: 0, maxHeight: 240, overflow: 'auto', background: '#f6f8fa', padding: 8 }}
            >
              {artifactText(artifact)}
            </pre>
          ))}
        </Space>
      )}

      <Input.TextArea
        rows={3}
        value={input}
        onChange={event => setInput(event.target.value)}
        placeholder={interrupt ? '输入补充信息后继续' : '输入消息，Enter 发送'}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <Space>
        <Button type="primary" icon={<SendOutlined />} loading={busy} onClick={() => void send()}>
          发送
        </Button>
        <Button icon={<StopOutlined />} disabled={!busy} onClick={() => void stop()}>
          停止
        </Button>
      </Space>
    </Space>
  );
}

function artifactText(artifact: Artifact): string {
  const parts = artifact.parts ?? [];
  const text = parts
    .map(part => {
      if (part.text) return part.text;
      if (part.data) return part.data;
      if (part.fileUrl) return part.fileUrl;
      return '';
    })
    .filter(Boolean)
    .join('\n');
  return text || JSON.stringify(artifact, null, 2);
}
