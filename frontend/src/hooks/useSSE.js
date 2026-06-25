import { useEffect, useRef, useCallback } from 'react';

/**
 * useSSE — subscribes to GET /api/v1/events and calls onEvent for each message.
 *
 * @param {(event: { type: string, payload: any, ts: string }) => void} onEvent
 * @param {boolean} enabled - set false to pause (e.g. tab hidden)
 */
export function useSSE(onEvent, enabled = true) {
  const esRef      = useRef(null);
  const onEventRef = useRef(onEvent);

  // Keep ref current without re-subscribing
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const connect = useCallback(() => {
    if (esRef.current) return;

    const es = new EventSource('/api/v1/events');
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.type !== 'connected') onEventRef.current(parsed);
      } catch { /* ignore malformed */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // Reconnect after 5 s
      setTimeout(() => { if (enabled) connect(); }, 5_000);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [enabled, connect]);
}
