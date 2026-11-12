import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { AuthorizationPolicy } from '@/api/policies';
import PolicyTable from './PolicyTable';

const policy: AuthorizationPolicy = {
  name: 'allow-agent-alpha',
  description: 'temporary rule',
  subjects: [{ kind: 'User', name: 'alice' }],
  resources: [{ kind: 'agent', names: ['alpha'] }],
  verbs: ['read', 'write'],
  effect: 'allow',
  status: 'enabled',
  updatedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
};

describe('PolicyTable', () => {
  it('links the policy name to its detail page and renders resources/verbs/effect', () => {
    render(
      <MemoryRouter>
        <PolicyTable policies={[policy]} />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: 'allow-agent-alpha' });
    expect(link).toHaveAttribute('href', '/policies/allow-agent-alpha');

    expect(screen.getAllByText('智能体：alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('读').length).toBeGreaterThan(0);
    expect(screen.getAllByText('写').length).toBeGreaterThan(0);
    expect(screen.getAllByText('允许').length).toBeGreaterThan(0);
    expect(screen.getAllByText('启用').length).toBeGreaterThan(0);
  });

  it('renders the optional source column', () => {
    render(
      <MemoryRouter>
        <PolicyTable policies={[policy]} sourceOf={() => <span>直接</span>} />
      </MemoryRouter>
    );
    expect(screen.getByRole('columnheader', { name: '来源' })).toBeInTheDocument();
    expect(screen.getAllByText('直接').length).toBeGreaterThan(0);
  });

  it('shows the empty text when no policy matches', () => {
    render(
      <MemoryRouter>
        <PolicyTable policies={[]} emptyText="没有命中的策略" />
      </MemoryRouter>
    );
    expect(screen.getAllByText('没有命中的策略').length).toBeGreaterThan(0);
  });
});
