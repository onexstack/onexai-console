import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TOKEN_UNAVAILABLE_TEXT, TokenUnavailableNotice } from './TokenUnavailable';

describe('TokenUnavailableNotice', () => {
  it('states plainly that user/group tokens are unavailable', () => {
    render(<TokenUnavailableNotice />);
    expect(screen.getByText('Token')).toBeInTheDocument();
    expect(screen.getByText(TOKEN_UNAVAILABLE_TEXT)).toBeInTheDocument();
    expect(TOKEN_UNAVAILABLE_TEXT).toContain('当前平台不支持用户 / 用户组级 Token');
  });
});
