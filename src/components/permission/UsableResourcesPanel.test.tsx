import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import UsableResourcesPanel from './UsableResourcesPanel';

describe('UsableResourcesPanel', () => {
  it('groups resources by kind and renders wildcard as “all, including future”', () => {
    render(
      <UsableResourcesPanel
        rows={[
          {
            key: 'agent/*',
            kind: 'agent',
            name: '*',
            verbs: ['read'],
            sources: ['baseline'],
          },
          {
            key: 'agent/alpha',
            kind: 'agent',
            name: 'alpha',
            verbs: ['read', 'write'],
            sources: ['allow-alpha'],
          },
        ]}
      />
    );

    expect(screen.getAllByText('智能体（2）').length).toBeGreaterThan(0);
    expect(screen.getAllByText('全部（含后续新增）').length).toBeGreaterThan(0);
    expect(screen.getAllByText('alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('读').length).toBeGreaterThan(0);
    expect(screen.getAllByText('写').length).toBeGreaterThan(0);
    expect(screen.getAllByText('baseline').length).toBeGreaterThan(0);
  });

  it('shows the empty state when nothing is usable', () => {
    render(<UsableResourcesPanel rows={[]} />);
    expect(
      screen.getAllByText('当前主体没有可操作资源，或所有授权均已停用').length
    ).toBeGreaterThan(0);
  });
});
