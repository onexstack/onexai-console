import { describe, expect, it } from 'vitest';

import type { ResourceSpec } from '@/api/resources';

import { deepMerge, initialValues, normalizeSubmit } from './form-model';

/** 一张只有 clientConfig 字段的最小资源描述。 */
const spec: ResourceSpec = {
  key: 'webhooks',
  title: 'Agent Webhook',
  name: 'Agent Webhook',
  idKey: 'name',
  idLabel: '名称',
  binding: {} as never,
  fields: [
    { key: 'name', label: '名称' },
    { key: 'clientConfig', label: 'ClientConfig', kind: 'clientConfig' },
  ],
  // normalizeSubmit 只处理 formFields 里列出的字段（其余是只读或派生的）。
  formFields: ['name', 'clientConfig'],
} as unknown as ResourceSpec;

/** 一张只有鉴权字段的最小资源描述。 */
const authSpec: ResourceSpec = {
  key: 'webhooks',
  title: 'Agent Webhook',
  name: 'Agent Webhook',
  idKey: 'name',
  idLabel: '名称',
  binding: {} as never,
  fields: [
    { key: 'name', label: '名称' },
    {
      key: 'secretRef',
      label: '鉴权凭据',
      kind: 'webhookAuth',
      authTokenField: 'authToken',
      refResource: 'secrets',
    },
  ],
  formFields: ['name', 'secretRef'],
} as unknown as ResourceSpec;

describe('webhookAuth', () => {
  it('derives a secret reference from the stored value', () => {
    const values = initialValues(authSpec, { name: 'w', secretRef: 'sec-1' }, false);
    expect(values['secretRef']).toEqual({ mode: 'secret', secretRef: 'sec-1' });
  });

  it('starts in the none mode when nothing is configured', () => {
    const values = initialValues(authSpec, null, true);
    expect(values['secretRef']).toEqual({ mode: 'none' });
  });

  it('splits the three modes back into secretRef/authToken', () => {
    const token = normalizeSubmit(
      authSpec,
      { secretRef: { mode: 'token', token: 'plain-token' } },
      true
    );
    expect(token.values['secretRef']).toBeUndefined();
    expect(token.values['authToken']).toBe('plain-token');

    const secret = normalizeSubmit(
      authSpec,
      { secretRef: { mode: 'secret', secretRef: 'sec-1' } },
      true
    );
    expect(secret.values['secretRef']).toBe('sec-1');
    expect(secret.values['authToken']).toBeUndefined();

    const none = normalizeSubmit(authSpec, { secretRef: { mode: 'none' } }, true);
    expect(Object.prototype.hasOwnProperty.call(none.values, 'secretRef')).toBe(true);
    expect(none.values['secretRef']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(none.values, 'authToken')).toBe(true);
    expect(none.values['authToken']).toBeUndefined();
  });

  it('clears a stored reference when the mode switches to none', () => {
    const merged = deepMerge(
      { secretRef: 'sec-1' },
      normalizeSubmit(authSpec, { secretRef: { mode: 'none' } }, false).values
    );
    expect(merged['secretRef']).toBeUndefined();
  });

  it('keeps a token that is still the active mode', () => {
    const merged = deepMerge(
      { secretRef: 'sec-1' },
      normalizeSubmit(
        authSpec,
        { secretRef: { mode: 'token', token: 'plain-token' } },
        false
      ).values
    );
    expect(merged['secretRef']).toBeUndefined();
    expect(merged['authToken']).toBe('plain-token');
  });
});

describe('normalizeSubmit / clientConfig', () => {
  it('sends the object as-is when a url is configured', () => {
    const out = normalizeSubmit(spec, { clientConfig: { url: 'https://a.example' } }, true);
    expect(out.values['clientConfig']).toEqual({ url: 'https://a.example', service: undefined });
  });

  it('marks the other side as undefined so an edit can clear it', () => {
    // 编辑路径最后是 deepMerge(record, values)：缺键会留下记录里的旧地址，
    // 于是「URL 改成 Service」会保存成两个地址同时存在，后端直接拒绝。
    const out = normalizeSubmit(
      spec,
      { clientConfig: { service: { namespace: 'default', name: 'svc' } } },
      false
    );
    const cfg = out.values['clientConfig'] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(cfg, 'url')).toBe(true);
    expect(cfg['url']).toBeUndefined();
    expect(cfg['service']).toEqual({ namespace: 'default', name: 'svc' });
  });

  it('treats an empty object as "not configured"', () => {
    const out = normalizeSubmit(spec, { clientConfig: {} }, false);
    expect(out.values['clientConfig']).toBeUndefined();
  });

  it('overrides the stored object when the configuration is removed entirely', () => {
    const merged = deepMerge(
      { clientConfig: { url: 'https://old.example' } },
      normalizeSubmit(spec, { name: 'w' }, false).values
    );
    expect(merged['clientConfig']).toBeUndefined();
  });

  it('keeps a stored url when it is still the configured address', () => {
    const merged = deepMerge(
      { clientConfig: { url: 'https://old.example', timeoutSeconds: 5 } },
      normalizeSubmit(spec, { clientConfig: { url: 'https://new.example' } }, false).values
    );
    expect(merged['clientConfig']).toEqual({
      url: 'https://new.example',
      service: undefined,
      timeoutSeconds: 5,
    });
  });
});
