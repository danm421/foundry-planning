// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImpersonationBanner } from '../impersonation-banner';

describe('ImpersonationBanner', () => {
  test('renders advisor name and logs warning', () => {
    render(<ImpersonationBanner advisorDisplayName="Jane Advisor" endSessionUrl="/api/impersonation/end" />);
    expect(screen.getByText(/Impersonating Jane Advisor/)).toBeTruthy();
    expect(screen.getByText(/all actions are logged/i)).toBeTruthy();
  });

  test('End Session button posts to endSessionUrl', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<ImpersonationBanner advisorDisplayName="Jane" endSessionUrl="/api/impersonation/end" />);
      fireEvent.click(screen.getByRole('button', { name: /end session/i }));
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledWith('/api/impersonation/end', expect.objectContaining({ method: 'POST' }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
