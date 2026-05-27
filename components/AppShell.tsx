'use client';

import { useEffect, useRef } from 'react';

export default function AppShell() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    // Future: bridge messages between iframe and Supabase here
    // For now, the iframe runs the prototype standalone with its demo data
    const handleMessage = (e: MessageEvent) => {
      // Reserved for future Supabase integration
      if (e.data?.type === '3ball:hello') {
        // console.log('App ready');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // The wrapper is position:fixed so it provides a bounded viewport context
  // for the iframe's content (scroll containment, correct anchoring of inner
  // position:fixed elements like the bottom nav). The iframe itself stays in
  // normal flow inside the wrapper — that's what keeps iOS Safari from
  // hijacking horizontal touch gestures (a known issue with position:fixed
  // iframes that broke table horizontal scroll until round 4).
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
      }}
    >
      <iframe
        ref={iframeRef}
        src="/app.html"
        title="3Ball Academy"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          border: 'none',
          margin: 0,
          padding: 0,
        }}
      />
    </div>
  );
}
