import { useEffect, useMemo, useState } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Col, Collapse, Form, Input, InputNumber, Row, Segmented, Switch } from 'antd';

import styles from './styles.module.scss';
import {
  decodeCA,
  encodeCA,
  normalize,
  type ClientConfigFormOptions,
  type ClientConfigValue,
} from './value';

/**
 * 第三方端点的统一配置控件。
 *
 * 线上形状就是 `admissionregistration.k8s.io/v1 WebhookClientConfig`（见后端的
 * `pkg/apis/agent/v1alpha1/clientconfig_types.go`）：`url` 与 `service` 二选一，
 * 再叠加 `caBundle` / `timeoutSeconds` / 平台扩展的 `insecureSkipTLSVerify`、
 * `headers`、`secretRef`、`headersRef`。
 *
 * # 为什么不再用 JSON 文本域
 *
 * 「URL 还是 Service」是一个二选一，用文本框表达时没有任何东西阻止同时填两个，
 * 而前端无从知道哪个字段写错了；`caBundle` 是 base64 PEM，手写极易少一个换行。
 * 结构化控件把互斥做成界面、把类型做对，剩下的值仍然按原样写回同一个 JSON 字段，
 * 后端协议一个字都不用改。
 *
 * # 空值即「不配置」
 *
 * 每一项留空都**不写进对象**，全空时回调 `undefined`，与其它字段「不填就是没设」
 * 的语义一致；写成 `{}` 会让后端的「是否配置了 ClientConfig」判断出现一个空壳。
 *
 * # 字段级选项
 *
 * Webhook 只需要 URL（Service 由它自己的顶层语义取代，超时/凭据也在顶层），
 * 但 MCP / A2A / RuntimeProfile 仍然需要完整形态。选项由资源描述符传入，
 * 默认值与历史行为完全一致。
 */

export interface ClientConfigFormProps extends ClientConfigFormOptions {
  id?: string;
  value?: ClientConfigValue;
  onChange?: (value: ClientConfigValue | undefined) => void;
  disabled?: boolean;
}

type Mode = 'url' | 'service';

interface HeaderRow {
  name: string;
  value: string;
}

/**
 * ClientConfigForm edits one ClientConfig.
 *
 * It is uncontrolled inside (a local draft) and pushes the normalized object up on
 * every change: the parent is a plain antd Form.Item, which means the value it
 * receives has to be a complete object, not a patch.
 */
export default function ClientConfigForm({
  id,
  value,
  onChange,
  disabled,
  modes,
  showTimeout = true,
  showCredentials = true,
  advancedCollapse = false,
  hideUrlLabel = false,
}: ClientConfigFormProps) {
  const allowService = modes ? modes.includes('service') : true;

  // 控件内部维护一份草稿，父级只是它的出口。
  //
  // 不能每次 onChange 都从 `value` 派生下一个状态：`value` 是上一次 emit 的回声，
  // 连续两次输入之间它可能还没更新（React 批处理），第二次就会拿着旧值把第一次
  // 的改动覆盖掉——典型症状是「切到 Service 后 url 又回来了」。
  const [draft, setDraft] = useState<ClientConfigValue>(() => value ?? {});

  // 连接方式是本地状态，不能由值推导：刚切到 Service 时还没有 service（用户尚未
  // 填），推导会让控件立刻弹回 URL。
  const [mode, setModeState] = useState<Mode>(() =>
    allowService && value?.service ? 'service' : 'url'
  );

  // 父级换了一份值（打开编辑、切换记录）时重置草稿与模式。依赖取内容是有意的：
  // 每次 onChange 父级都给一个新对象，按引用比较会把草稿打回上一次的值。
  const valueKey = useMemo(() => JSON.stringify(value ?? {}), [value]);
  useEffect(() => {
    const parsed = JSON.parse(valueKey) as ClientConfigValue;
    setDraft(parsed);
    // 同时写回 url：只判断 service 会让“从 Service 记录切到 URL 记录”仍停在
    // Service 模式（字段被清空、界面看起来像丢了地址）。
    setModeState(allowService && parsed.service ? 'service' : 'url');
  }, [valueKey, allowService]);

  // 请求头在控件里是「一行一个」，线上是对象；行从草稿派生，但保留正在输入的空
  // 名字行（它还没写进对象）。
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const headersKey = useMemo(() => JSON.stringify(draft.headers ?? {}), [draft.headers]);
  useEffect(() => {
    const parsed = JSON.parse(headersKey) as Record<string, string>;
    setHeaders(
      Object.entries(parsed).map(([name, headerValue]) => ({ name, value: String(headerValue) }))
    );
  }, [headersKey]);

  /**
   * update merges a patch into the draft and publishes the normalized result.
   *
   * It also enforces the URL/Service exclusivity on **every** write, not only on
   * the mode switch: a patch that carries a stale copy of the other side must not
   * resurrect it.
   */
  const update = (patch: Partial<ClientConfigValue>, forcedMode?: Mode) => {
    const activeMode = allowService ? (forcedMode ?? mode) : 'url';
    const next: ClientConfigValue = { ...draft, ...patch };
    if (!allowService || activeMode !== 'service') next.service = undefined;
    if (activeMode === 'service') next.url = undefined;
    setDraft(next);
    onChange?.(
      normalize(next, {
        keepService: allowService,
        keepTimeout: showTimeout,
        keepCredentials: showCredentials,
      })
    );
  };

  const setMode = (next: Mode) => {
    if (next === mode) return;
    setModeState(next);
    // 两个地址互斥：切过去就把另一个清掉，否则后端按「同时填了 url 与 service」
    // 拒绝保存。
    update(next === 'url' ? { service: undefined } : { url: undefined }, next);
  };

  const commitHeaders = (rows: HeaderRow[]) => {
    setHeaders(rows);
    const map: Record<string, string> = {};
    for (const row of rows) {
      const name = row.name.trim();
      if (name) map[name] = row.value;
    }
    update({ headers: Object.keys(map).length ? map : undefined });
  };

  const tlsItem = (
    <Form.Item label="跳过 TLS 校验" className={styles.item}>
      <Switch
        disabled={disabled}
        checked={draft.insecureSkipTLSVerify === true}
        onChange={checked => update({ insecureSkipTLSVerify: checked || undefined })}
      />
      <span className={styles.hint}>仅自签证书的本地环境；生产请改用 CA Bundle</span>
    </Form.Item>
  );

  const caItem = (
    <Form.Item
      label="CA Bundle"
      className={styles.item}
      extra="可选。留空使用系统根证书；仅自签/私有 CA 需要填写（PEM 原文即可，保存时自动 base64）"
    >
      <Input.TextArea
        disabled={disabled}
        rows={3}
        value={decodeCA(draft.caBundle)}
        placeholder="-----BEGIN CERTIFICATE-----"
        style={{ fontFamily: 'var(--font-family-code, monospace)', fontSize: 12 }}
        onChange={event => update({ caBundle: encodeCA(event.target.value) })}
      />
    </Form.Item>
  );

  const headersItem = (
    <Form.Item label="请求头" className={styles.item} extra="需要鉴权时在这里加，例如 Authorization">
      <div className={styles.headers}>
        {headers.map((row, index) => (
          <div key={index} className={styles.headerRow}>
            <Input
              disabled={disabled}
              placeholder="Header 名"
              value={row.name}
              onChange={event =>
                commitHeaders(
                  headers.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item
                  )
                )
              }
            />
            <Input
              disabled={disabled}
              placeholder="值"
              value={row.value}
              onChange={event =>
                commitHeaders(
                  headers.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item
                  )
                )
              }
            />
            <Button
              type="text"
              danger
              disabled={disabled}
              icon={<DeleteOutlined />}
              onClick={() => commitHeaders(headers.filter((_, i) => i !== index))}
            />
          </div>
        ))}
        <Button
          type="dashed"
          block
          disabled={disabled}
          icon={<PlusOutlined />}
          onClick={() => commitHeaders([...headers, { name: '', value: '' }])}
        >
          添加请求头
        </Button>
      </div>
    </Form.Item>
  );

  return (
    <div className={styles.wrap} id={id}>
      {allowService && (
        <Form.Item label="连接方式" className={styles.item}>
          <Segmented<Mode>
            disabled={disabled}
            value={mode}
            onChange={setMode}
            options={[
              { label: 'URL', value: 'url' },
              { label: 'Service', value: 'service' },
            ]}
          />
        </Form.Item>
      )}

      {mode === 'url' ? (
        <Form.Item
          label={hideUrlLabel ? undefined : 'URL'}
          className={styles.item}
          extra={hideUrlLabel ? undefined : '必须写死 scheme 与 host：http:// 或 https://'}
        >
          <Input
            disabled={disabled}
            value={draft.url ?? ''}
            placeholder="https://example.com/hook"
            onChange={event => update({ url: event.target.value.trim() || undefined })}
          />
        </Form.Item>
      ) : (
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="命名空间" className={styles.item}>
              <Input
                disabled={disabled}
                value={draft.service?.namespace ?? ''}
                placeholder="default"
                onChange={event =>
                  update({
                    service: { ...draft.service, namespace: event.target.value.trim() || undefined },
                  })
                }
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Service 名" className={styles.item}>
              <Input
                disabled={disabled}
                value={draft.service?.name ?? ''}
                placeholder="my-service"
                onChange={event =>
                  update({
                    service: { ...draft.service, name: event.target.value.trim() || undefined },
                  })
                }
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="端口" className={styles.item}>
              <InputNumber
                disabled={disabled}
                min={1}
                max={65535}
                style={{ width: '100%' }}
                value={draft.service?.port}
                placeholder="443"
                onChange={port =>
                  update({
                    service: {
                      ...draft.service,
                      port: typeof port === 'number' ? port : undefined,
                    },
                  })
                }
              />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="路径" className={styles.item}>
              <Input
                disabled={disabled}
                value={draft.service?.path ?? ''}
                placeholder="/hook"
                onChange={event =>
                  update({
                    service: { ...draft.service, path: event.target.value.trim() || undefined },
                  })
                }
              />
            </Form.Item>
          </Col>
        </Row>
      )}

      {advancedCollapse ? (
        <Collapse
          className={styles.advanced}
          size="small"
          // forceRender：折叠时不挂载的字段会丢掉内部草稿（请求头行），
          // 展开后看起来像被清空了。
          items={[
            {
              key: 'advanced',
              label: '高级连接设置',
              forceRender: true,
              children: (
                <>
                  {tlsItem}
                  {caItem}
                  {headersItem}
                </>
              ),
            },
          ]}
        />
      ) : (
        <>
          {showTimeout ? (
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item label="超时（秒）" className={styles.item}>
                  <InputNumber
                    disabled={disabled}
                    min={1}
                    max={600}
                    style={{ width: '100%' }}
                    value={draft.timeoutSeconds}
                    placeholder="30"
                    onChange={seconds =>
                      update({
                        timeoutSeconds: typeof seconds === 'number' ? seconds : undefined,
                      })
                    }
                  />
                </Form.Item>
              </Col>
              <Col span={16}>{tlsItem}</Col>
            </Row>
          ) : (
            tlsItem
          )}
          {caItem}
          {headersItem}
        </>
      )}

      {showCredentials && (
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="凭据 Secret" className={styles.item} extra="整个 Secret 作为凭据来源">
              <Input
                disabled={disabled}
                value={draft.secretRef?.name ?? ''}
                placeholder="my-credentials"
                onChange={event =>
                  update({
                    secretRef: {
                      ...draft.secretRef,
                      name: event.target.value.trim() || undefined,
                    },
                  })
                }
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="Secret 键" className={styles.item} extra="留空表示读取整个 Secret">
              <Input
                disabled={disabled}
                value={draft.secretRef?.key ?? ''}
                placeholder="token"
                onChange={event =>
                  update({
                    secretRef: { ...draft.secretRef, key: event.target.value.trim() || undefined },
                  })
                }
              />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item label="请求头 Secret" className={styles.item} extra="用 Secret 里的键值补充请求头">
              <Input
                disabled={disabled}
                value={draft.headersRef?.name ?? ''}
                placeholder="my-headers"
                onChange={event =>
                  update({
                    headersRef: event.target.value.trim()
                      ? { name: event.target.value.trim() }
                      : undefined,
                  })
                }
              />
            </Form.Item>
          </Col>
        </Row>
      )}

      {allowService && draft.url && draft.service && (
        <Alert
          type="warning"
          showIcon
          title="url 与 service 只能填一个"
          description="保存前请清空其中一个；后端会拒绝同时配置两者。"
        />
      )}
    </div>
  );
}
