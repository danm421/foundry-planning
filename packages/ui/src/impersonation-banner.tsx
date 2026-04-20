'use client';
import { useState } from 'react';

export type ImpersonationBannerProps = {
  advisorDisplayName: string;
  endSessionUrl: string;
};

export function ImpersonationBanner({ advisorDisplayName, endSessionUrl }: ImpersonationBannerProps) {
  const [ending, setEnding] = useState(false);

  async function endSession() {
    if (ending) return;
    setEnding(true);
    const res = await fetch(endSessionUrl, { method: 'POST', credentials: 'include' });
    if (res.redirected) {
      window.location.href = res.url;
    } else if (res.ok) {
      window.location.reload();
    } else {
      setEnding(false);
      alert('Failed to end session.');
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: '#b91c1c',
        color: 'white',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontWeight: 600,
      }}
    >
      <span>Impersonating {advisorDisplayName} — all actions are logged.</span>
      <button
        type="button"
        onClick={endSession}
        disabled={ending}
        style={{
          background: 'white',
          color: '#b91c1c',
          border: 'none',
          padding: '6px 12px',
          borderRadius: 4,
          fontWeight: 600,
          cursor: ending ? 'not-allowed' : 'pointer',
        }}
      >
        {ending ? 'Ending…' : 'End Session'}
      </button>
    </div>
  );
}
