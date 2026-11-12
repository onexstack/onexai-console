import { describe, expect, it } from 'vitest';

import { authValueFromSecretRef, splitWebhookAuth } from './value';

describe('authValueFromSecretRef', () => {
  it('derives the secret mode from a stored reference', () => {
    expect(authValueFromSecretRef('sec-1')).toEqual({ mode: 'secret', secretRef: 'sec-1' });
  });

  it('starts in the none mode for an empty value', () => {
    expect(authValueFromSecretRef(undefined)).toEqual({ mode: 'none' });
    expect(authValueFromSecretRef('')).toEqual({ mode: 'none' });
  });
});

describe('splitWebhookAuth', () => {
  it('keeps a pasted token verbatim', () => {
    expect(splitWebhookAuth({ mode: 'token', token: ' a b ' })).toEqual({ authToken: ' a b ' });
  });

  it('treats a whitespace-only token as not filled', () => {
    expect(splitWebhookAuth({ mode: 'token', token: '   ' })).toEqual({});
  });

  it('emits only the active mode', () => {
    expect(splitWebhookAuth({ mode: 'secret', secretRef: ' sec-1 ' })).toEqual({
      secretRef: 'sec-1',
    });
    expect(splitWebhookAuth({ mode: 'none', secretRef: 'sec-1', token: 'tok' })).toEqual({});
  });
});
