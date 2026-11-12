import { agentClient, request } from './client';
import { AGENT } from './endpoints';

/**
 * 控制面扩展对象（管理员）。
 *
 * 这些资源不是平台自己的 CRD，而是 `oai-declserver` 直接用 kube-apiserver 的能力
 * 提供的：准入 Webhook 配置、CEL 准入策略及其绑定、聚合 API 注册。控制台读写的是
 * **API Server 存储的原始 JSON**，不做字段映射——上游加一个字段，这里不用跟着改，
 * 页面也不会把它悄悄丢掉。
 */

export interface ExtensionKind {
  /** URL 段与 API resource 名一致。 */
  resource: string;
  /** API kind，新建对象时用来填 apiVersion/kind。 */
  kind: string;
  group: string;
  version: string;
  displayName: string;
  description: string;
}

/** 无类型的 Kubernetes 对象：结构由 `apiVersion` 决定。 */
export type ExtensionObject = Record<string, unknown> & {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    resourceVersion?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
};

export async function listExtensionKinds(): Promise<ExtensionKind[]> {
  const data = await request<{ kinds: ExtensionKind[] }>(agentClient, {
    url: AGENT.extensions,
    method: 'GET',
  });
  return data.kinds;
}

export async function listExtensions(resource: string): Promise<ExtensionObject[]> {
  const data = await request<{ items: ExtensionObject[] }>(agentClient, {
    url: AGENT.extensionObjects(resource),
    method: 'GET',
  });
  return data.items;
}

export async function getExtension(resource: string, name: string): Promise<ExtensionObject> {
  return request<ExtensionObject>(agentClient, {
    url: AGENT.extensionObject(resource, name),
    method: 'GET',
  });
}

export async function createExtension(
  resource: string,
  body: ExtensionObject,
): Promise<ExtensionObject> {
  return request<ExtensionObject>(agentClient, {
    url: AGENT.extensionObjects(resource),
    method: 'POST',
    data: body,
  });
}

export async function updateExtension(
  resource: string,
  name: string,
  body: ExtensionObject,
): Promise<ExtensionObject> {
  return request<ExtensionObject>(agentClient, {
    url: AGENT.extensionObject(resource, name),
    method: 'PUT',
    data: body,
  });
}

export async function deleteExtension(resource: string, name: string): Promise<void> {
  await request<{ deleted: string }>(agentClient, {
    url: AGENT.extensionObject(resource, name),
    method: 'DELETE',
  });
}
