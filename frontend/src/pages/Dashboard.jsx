import React, { useEffect, useState } from 'react';
import { getHealth, getAllBookings } from '../api.js';
import {
  Activity, Bot, Clock, Server, CalendarDays,
  TrendingUp, RefreshCw,
} from 'lucide-react';
import dayjs from 'dayjs';

const StatCard = ({ icon: Icon, label, value, sub, accent }) => {
  const accents = {
    green:  { ring: 'border-brand-900',  icon: 'text-brand-400',  bg: 'bg-brand-950'  },
    blue:   { ring: 'border-blue-900',   icon: 'text-blue-400',   bg: 'bg-blue-950'   },
    purple: { ring: 'border-purple-900', icon: 'text-purple-400', bg: 'bg-purple-950' },
    amber:  { ring: 'border-amber-900',  icon: 'text-amber-400',  bg: 'bg-amber-950'  },
  };
  const a = accents[accent] ?? accents.green;
  return (
    <div className={`bg-gray-900 border ${a.ring} rounded-xl p-5 flex gap-4 items-start`}>
      <div className={`${a.bg} rounded-lg p-2.5 mt-0.5`}>
        <Icon size={18} className={a.icon} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className="text-2xl font-bold text-white leading-none">{value}</p>
        {sub && <p className="text-xs text-gray-600 mt-1 truncate">{sub}</p>}
      </div>
    </div>
  );
};

const ConfigRow = ({ label, value }) => (
  <div className="flex justify-between border-b border-gray-800/60 pb-2 last:border-0 last:pb-0">
    <span className="text-gray-500">{label}</span>
    <span className="text-gray-300 font-mono">{value}</span>
  </div>
);

export default function Dashboard() {
  const [health,      setHealth]      = useState(null);
  const [healthError, setHealthError] = useState(false);
  const [bookings,    setBookings]    = useState([]);
  const [loading,     setLoading]     = useState(true);

  const load = async () => {
    setLoading(true);
    setHealthError(false);
    try {
      const [hRes, bRes] = await Promise.allSettled([getHealth(), getAllBookings()]);
      if (hRes.status === 'fulfilled') setHealth(hRes.value.data);
      else setHealthError(true);
      if (bRes.status === 'fulfilled') setBookings(bRes.value.data.data.bookings ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const today      = dayjs().format('YYYY-MM-DD');
  const todayCount = bookings.filter(b => dayjs(b.startISO).format('YYYY-MM-DD') === today).length;
  const weekCount  = bookings.filter(b => dayjs(b.startISO).isAfter(dayjs().startOf('week'))).length;

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white mb-0.5">Dashboard</h1>
          <p className="text-sm text-gray-500">BookBot MainMenu — system overview</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {healthError && (
        <div className="mb-6 bg-rose-950 border border-rose-800 text-rose-400 text-sm rounded-lg px-4 py-3">
          ⚠️ Could not reach the backend server. Make sure it is running on port 3000.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Activity}
          label="Server Status"
          value={health ? '🟢 Online' : healthError ? '🔴 Offline' : '…'}
          sub={health?.environment}
          accent="green"
        />
        <StatCard
          icon={CalendarDays}
          label="Bookings Today"
          value={todayCount}
          sub={`${weekCount} this week`}
          accent="blue"
        />
        <StatCard
          icon={Clock}
          label="Uptime"
          value={health?.uptime?.human ?? '—'}
          sub="since last restart"
          accent="purple"
        />
        <StatCard
          icon={Bot}
          label="Google Chat"
          value={health?.services?.googleChat?.configured ? '🟢 Ready' : '🔴 Missing'}
          sub={health?.services?.googleChat?.projectNumber ? `Project: ${health.services.googleChat.projectNumber}` : undefined}
          accent="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={15} className="text-brand-400" />
            <span className="text-sm font-semibold text-white">Upcoming Bookings</span>
          </div>
          {bookings.length === 0 ? (
            <p className="text-xs text-gray-600 py-4">No upcoming bookings</p>
          ) : (
            <div className="space-y-2">
              {bookings.slice(0, 8).map(b => (
                <div key={b.bookingRef} className="flex items-center justify-between text-xs border-b border-gray-800/60 pb-2 last:border-0 last:pb-0">
                  <span className="font-mono text-gray-400">{b.bookingRef}</span>
                  <span className="text-gray-500 truncate max-w-[180px] text-right">
                    {b.customerName} · {dayjs(b.startISO).format('D MMM, h:mm A')}
                  </span>
                </div>
              ))}
              {bookings.length > 8 && (
                <p className="text-xs text-gray-600 pt-1">+{bookings.length - 8} more</p>
              )}
            </div>
          )}
        </div>

        {health && (
          <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Server size={15} className="text-purple-400" />
              <span className="text-sm font-semibold text-white">Configuration</span>
            </div>
            <div className="space-y-2.5 text-xs">
              <ConfigRow label="Working Hours" value={health.services.driver.workingHours} />
              <ConfigRow label="Min Slot"      value={`${health.services.driver.minSlotMinutes} min`} />
              <ConfigRow label="Timezone"      value={health.services.driver.timezone} />
              <ConfigRow label="Memory"        value={`${health.memory.heapUsedMB} / ${health.memory.heapTotalMB} MB`} />
              <ConfigRow label="Chat Project"  value={health.services.googleChat.projectNumber} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
