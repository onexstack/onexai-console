import { useCallback, useRef, useState } from 'react';
import { Alert, Button, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

import { testMcp } from '@/api/agent';
import type { McpTestResult } from '@/api/types';
import { normalizeSubmit } from '@/components/ResourceForm/form-model';
import type { ResourceSpec } from '@/api/resources';

import styles from './styles.module.scss';

/**
 * 真正参与拨号的字段。它们一变，上一次「连接正常」就不再代表当前配置，
 * 因此指纹里只放这三项，而不是整张表单。
 */
const CONNECTIVITY_KEYS = ['protocol', 'url', 'headers'] as const;

export interface McpTestState extends McpTestResult {
  /** 发起请求时的连接参数指纹；用来判断结果是否已经过期。 */
  fingerprint: string;
}

interface UseMcpConnectionTestOptions {
  enabled: boolean;
  spec: ResourceSpec | undefined;
  form: FormInstance<Record<string, unknown>>;
  isCreate: boolean;
}

/**
 * MCP 连通性测试的状态与动作。
 *
 * 测试请求用的就是表单当前值（经 `normalizeSubmit` 序列化），不从后端按 name
 * 回填：否则用户清空 URL/请求头后，测试会悄悄拿旧值拨号并「通过」。
 *
 * 通用表单页只在「工具与审批」步调用这里的 `ensureTested`，其余资源
 * `enabled=false`，所有动作直接放行。
 */
export function useMcpConnectionTest({
  enabled,
  spec,
  form,
  isCreate,
}: UseMcpConnectionTestOptions) {
  const [state, setState] = useState<McpTestState | null>(null);
  const [testing, setTesting] = useState(false);
  /** 并发拨号去重：连点「下一步」只发一条请求。 */
  const inflight = useRef<Promise<boolean> | null>(null);
  /** 配置变化时递增；旧请求的回包据此丢弃，避免把新值标成已通过。 */
  const generation = useRef(0);

  const fingerprint = useCallback(() => {
    const values = form.getFieldsValue(true) as Record<string, unknown>;
    return JSON.stringify(CONNECTIVITY_KEYS.map(key => values[key] ?? ''));
  }, [form]);

  const run = useCallback(async (): Promise<boolean> => {
    if (!enabled) return true;
    if (!spec) return false;
    if (inflight.current) return inflight.current;

    const gen = generation.current;
    const values = form.getFieldsValue(true) as Record<string, unknown>;
    const normalized = normalizeSubmit(spec, values, isCreate);
    const current = fingerprint();
    if (normalized.error) {
      setState({ ok: false, message: normalized.error, fingerprint: current });
      return false;
    }

    // 探测的是「这个端点有哪些工具」，不能被当前的白名单过滤掉：否则第二次
    // 测试只会返回上次选中的那几个，用户再也看不到完整候选。连通性与白名单无关。
    const probe = { ...normalized.values };
    delete probe.allowedTools;

    setTesting(true);
    const request = testMcp({ mcp: probe })
      .then(result => {
        if (gen !== generation.current) return false;
        // 请求期间又改了配置：这次结果不能代表当前值，当作未测试处理。
        if (current !== fingerprint()) {
          setState(null);
          return false;
        }
        setState({ ...result, fingerprint: current });
        return result.ok === true;
      })
      .catch((err: unknown) => {
        if (gen !== generation.current) return false;
        const message =
          err instanceof Error && err.message.trim() ? err.message.trim() : '请求失败，请稍后重试';
        setState({ ok: false, message, fingerprint: current });
        return false;
      })
      .finally(() => {
        if (gen !== generation.current) return;
        setTesting(false);
        inflight.current = null;
      });

    inflight.current = request;
    return request;
  }, [enabled, spec, form, isCreate, fingerprint]);

  /** 已有通过结果且配置没变 → 直接放行；否则现场测一次。 */
  const ensureTested = useCallback(async (): Promise<boolean> => {
    if (!enabled) return true;
    if (state?.ok === true && state.fingerprint === fingerprint()) return true;
    return run();
  }, [enabled, state, fingerprint, run]);

  /** 配置或路由变了：旧结果作废，同时丢弃仍在途的回包。 */
  const reset = useCallback(() => {
    generation.current += 1;
    inflight.current = null;
    setTesting(false);
    setState(null);
  }, []);

  return { state, testing, run, ensureTested, reset };
}

interface MCPConnectionTestPanelProps {
  state: McpTestState | null;
  testing: boolean;
  onTest: () => void;
}

/** 「工具与审批」步顶部的连通性检查面板：先测通，再拿工具列表选工具。 */
export function MCPConnectionTestPanel({ state, testing, onTest }: MCPConnectionTestPanelProps) {
  const passed = state?.ok === true;
  return (
    <div className={styles.connectivity}>
      <div className={styles.connectivityHead}>
        <div className={styles.connectivityText}>
          <div className={styles.connectivityTitle}>连通性检查</div>
          <div className={styles.connectivityHint}>
            测试通过后可选工具；修改协议、接入地址或请求头需重测。
          </div>
        </div>
        <Button icon={<ThunderboltOutlined />} loading={testing} onClick={onTest}>
          测试
        </Button>
      </div>

      {passed ? (
        <Alert
          type="success"
          showIcon
          className={styles.connectivityAlert}
          title={`连接正常 · 发现 ${state.tools?.length ?? 0} 个工具 · 耗时 ${state.latencyMs ?? 0}ms · ${
            state.tools?.length ? '已填入下方候选' : '未暴露任何工具'
          }`}
        />
      ) : state ? (
        <Alert
          type="error"
          showIcon
          title="连接失败"
          description={
            <Typography.Paragraph
              copyable={{ text: state.message, tooltips: ['复制错误详情', '已复制'] }}
              style={{ margin: 0, wordBreak: 'break-word', color: 'inherit' }}
            >
              {state.message?.trim() || '上游未返回错误详情'}
            </Typography.Paragraph>
          }
        />
      ) : (
        <Alert type="info" showIcon title="尚未测试" />
      )}
    </div>
  );
}
