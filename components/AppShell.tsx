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

  return (
    <iframe
      ref={iframeRef}
      src="/app.html"
      title="3Ball Academy"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        border: 'none',
        margin: 0,
        padding: 0,
      }}
    />
  );
}
