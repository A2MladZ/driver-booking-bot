import React, { useEffect, useState } from 'react';
import { getHealth } from '../api.js';
import { RefreshCw, Loader } from 'lucide-react';

const StatusDot = ({ ok }) => (
  <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-brand-500' : 'bg-red-500'}`} />
);

const Section = ({ title, children }) => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-4">
    <h2 className="text-sm font-semibold text-gray-300 mb-4">{title}</h2>
    <div className="space-y-3 text-sm">{children}</div>
  </div>
);

const Row = ({ label, value, ok }) => (
  <div className="flex items-center justify-between border-b border-gray-800 pb-2 last:border-0 last:pb-0">
    <div className="flex items-center gap-2 text-gray-400">
      {ok !== undefined && <StatusDot ok={ok} />}
      {label}
    </div>
    <span className="text-gray-200 font-mono text-xs">{String(value ?? '—')}</span>
  </div>
);

export default function Health() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await getHealth();
      setData(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Health</h1>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
        >
          {loading ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">Live server and service status.</p>

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">
          ⚠️ Backend unreachable. Make sure the server is running on port 3000.
        </div>
      )}

      {data && (
        <>
          <Section title="Server">
            <Row label="Status"      value={data.status.toUpperCase()} ok={data.status === 'ok'} />
            <Row label="Environment" value={data.environment} />
            <Row label="Uptime"      value={data.uptime.human} />
            <Row label="Timestamp"   value={new Date(data.timestamp).toLocaleString()} />
          </Section>

          <Section title="Memory">
            <Row label="Heap Used"  value={`${data.memory.heapUsedMB} MB`} />
            <Row label="Heap Total" value={`${data.memory.heapTotalMB} MB`} />
            <Row label="RSS"        value={`${data.memory.rssMB} MB`} />
          </Section>

          <Section title="Google Chat">
            <Row label="Configured"      value={data.services.googleChat.configured ? 'Yes' : 'No'} ok={data.services.googleChat.configured} />
            <Row label="Project Number"  value={data.services.googleChat.projectNumber} />
          </Section>

          <Section title="Google Calendar">
            <Row label="Configured"  value={data.services.googleCalendar.configured ? 'Yes' : 'No'} ok={data.services.googleCalendar.configured} />
            <Row label="Calendar ID" value={data.services.googleCalendar.calendarId} />
          </Section>

          <Section title="Driver Settings">
            <Row label="Timezone"      value={data.services.driver.timezone} />
            <Row label="Working Hours" value={data.services.driver.workingHours} />
            <Row label="Min Slot"      value={`${data.services.driver.minSlotMinutes} min`} />
          </Section>
        </>
      )}
    </div>
  );
}
