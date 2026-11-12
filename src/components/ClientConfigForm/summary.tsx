import { Space, Tag } from 'antd';

import type { ClientConfigValue } from './value';

/**
 * ClientConfigSummary is the read-only rendering of one endpoint configuration.
 *
 * The list and detail pages show a field per row, and a ClientConfig is an
 * object; without this it would render as a pile of `key=value` tags. The summary
 * names the one thing the row is about (which address the platform dials) and
 * then the modifiers that change how it dials it.
 */
export default function ClientConfigSummary({ value }: { value?: ClientConfigValue }) {
  if (!value) return <span>-</span>;

  const service = value.service;
  const address = service?.name
    ? `Service ${service.namespace ?? ''}/${service.name}${service.port ? `:${service.port}` : ''}${
        service.path ?? ''
      }`
    : value.url;

  return (
    <Space size={[4, 4]} wrap>
      {address ? <Tag color="blue">{address}</Tag> : <Tag color="orange">未配置地址</Tag>}
      {value.url && service ? <Tag color="red">url 与 service 同时存在</Tag> : null}
      {typeof value.timeoutSeconds === 'number' ? (
        <Tag>{`超时 ${value.timeoutSeconds}s`}</Tag>
      ) : null}
      {value.headers ? <Tag>{`请求头 ${Object.keys(value.headers).length} 项`}</Tag> : null}
      {value.caBundle ? <Tag>自定义 CA</Tag> : null}
      {value.insecureSkipTLSVerify ? <Tag color="orange">跳过 TLS 校验</Tag> : null}
      {value.secretRef?.name ? (
        <Tag>{`凭据 ${value.secretRef.name}${value.secretRef.key ? `#${value.secretRef.key}` : ''}`}</Tag>
      ) : null}
      {value.headersRef?.name ? <Tag>{`请求头 Secret ${value.headersRef.name}`}</Tag> : null}
    </Space>
  );
}
