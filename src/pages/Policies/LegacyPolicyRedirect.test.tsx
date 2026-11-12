import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { describe, expect, it } from 'vitest';

import LegacyPolicyRedirect from './LegacyPolicyRedirect';

function PolicyProbe() {
  const { name } = useParams<{ name: string }>();
  return <div>policy:{name}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/authz-rules/:id" element={<LegacyPolicyRedirect />} />
        <Route path="/policies/:name" element={<PolicyProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LegacyPolicyRedirect', () => {
  it('sends /authz-rules/:id to the matching policy detail', () => {
    renderAt('/authz-rules/baseline');
    expect(screen.getByText('policy:baseline')).toBeInTheDocument();
  });

  it('preserves names that need URL encoding', () => {
    renderAt('/authz-rules/custom%20policy');
    expect(screen.getByText('policy:custom policy')).toBeInTheDocument();
  });
});
