'use client';

import { useState } from 'react';

type Props = {
  advisorClerkUserId: string;
  firmId: string;
};

export default function ImpersonateButton({ advisorClerkUserId, firmId }: Props) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/impersonation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advisorClerkUserId, firmId, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Unknown error');
        return;
      }
      window.location.href = data.redirect;
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 24 }}>
      <h3>Impersonate this advisor</h3>
      <div>
        <label htmlFor="reason">Reason (required)</label>
        <br />
        <textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          cols={60}
          placeholder="Why are you impersonating this advisor?"
          disabled={loading}
        />
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button type="submit" disabled={loading || !reason.trim()}>
        {loading ? 'Starting…' : 'Impersonate'}
      </button>
    </form>
  );
}
