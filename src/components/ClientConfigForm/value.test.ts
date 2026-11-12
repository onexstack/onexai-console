import { describe, expect, it } from 'vitest';

import { decodeCA, encodeCA, normalize } from './value';

describe('normalize', () => {
  it('drops empty fields so an untouched form means "not configured"', () => {
    expect(normalize({ url: '', service: {}, headers: {} })).toBeUndefined();
    expect(normalize({})).toBeUndefined();
  });

  it('keeps only what was filled in', () => {
    expect(
      normalize({
        url: 'https://example.com/hook',
        timeoutSeconds: 10,
        headers: { 'X-Tenant': 'onexai' },
        insecureSkipTLSVerify: true,
      }),
    ).toEqual({
      url: 'https://example.com/hook',
      timeoutSeconds: 10,
      headers: { 'X-Tenant': 'onexai' },
      insecureSkipTLSVerify: true,
    });
  });

  it('keeps the service reference and drops its blank parts', () => {
    expect(normalize({ service: { namespace: 'default', name: 'svc', port: 443, path: '' } })).toEqual(
      {
        service: { namespace: 'default', name: 'svc', port: 443 },
      },
    );
  });

  it('does not invent a secretRef from an empty one', () => {
    expect(normalize({ url: 'https://a.example', secretRef: { name: '', key: '' } })).toEqual({
      url: 'https://a.example',
    });
  });

  it('writes hidden fields as explicit undefined so an edit can clear them', () => {
    expect(
      normalize(
        {
          url: 'https://a.example',
          service: { namespace: 'default', name: 'svc' },
          timeoutSeconds: 10,
          secretRef: { name: 'old' },
          headersRef: { name: 'old-headers' },
        },
        { keepService: false, keepTimeout: false, keepCredentials: false },
      ),
    ).toEqual({
      url: 'https://a.example',
      service: undefined,
      timeoutSeconds: undefined,
      secretRef: undefined,
      headersRef: undefined,
    });
  });

  it('treats a hidden-only configuration as "not configured"', () => {
    expect(
      normalize({ service: { namespace: 'default', name: 'svc' } }, { keepService: false }),
    ).toBeUndefined();
  });
});

describe('CA bundle round-trip', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

  it('stores PEM as base64 and shows it back as PEM', () => {
    const stored = encodeCA(pem);
    expect(stored).toBe(btoa(pem.trim()));
    expect(decodeCA(stored)).toBe(pem.trim());
  });

  it('leaves an already-base64 value alone on save', () => {
    const stored = btoa(pem);
    expect(encodeCA(stored)).toBe(stored);
    expect(decodeCA(stored)).toBe(pem);
  });

  it('shows a value that is neither PEM nor base64 as-is', () => {
    expect(decodeCA('not base64 at all!')).toBe('not base64 at all!');
  });
});
