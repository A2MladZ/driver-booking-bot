import React, { useEffect, useState, useCallback, useRef } from 'react';
import { getHealth, getAllBookings } from '../api.js';
import { useSSE } from '../hooks/useSSE.js';
import {
  Activity, Bot, Clock, Server, CalendarDays,
  Bell, CheckCheck, TrendingUp, Users, Zap,
} from 'lucide-react';
import dayjs from 'dayjs';

// ── Colour map for event types ────────────────────────────────────────────────
const EVENT_META = {
  booking_created:   { label: 'Booking Created',   dot: 'bg-brand-500',  text: 'text-brand-400'  },
  booking_cancelled: { label: 'Booking Cancelled',  dot: 'bg-rose-500',   text: 'text-rose-400'   },
  whatsapp_message:  { label: 'WhatsApp Message',   dot: 'bg-blue-500',   text: 'text-blue-400'   },
  calendar_sync:     { label: 'Calendar Sync',      dot: 'bg-purple-500', text: 'text-purple-400' },
  system_error:      { label: 'System Error',       dot: 'bg-rose-500',   text: 'text-rose-400'   },
  system_info:       { label: 'System',             dot: 'bg-amber-500',  text: 'text-amber-400'  },
};

// ── Stat card ─────────────────────────────────────────────────────────────────
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

// ── Activity feed item ────────────────────────────────────────────────────────
const FeedItem = ({ event, animate }) => {
  const meta = EVENT_META[event.type] ?? EVENT_META.system_info;
  return (
    <div className={`flex items-start gap-3 py-2.5 border-b border-gray-800/60 last:border-0 ${animate ? 'animate-slide-in' : ''}`}>
      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs font-medium ${meta.text}`}>{meta.label}</span>
          <span className="text-[10px] text-gray-600 shrink-0">
            {dayjs(event.ts).format('HH:mm:ss')}
          </span>
        </div>
        {event.payload?.message && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{event.payload.message}</p>
        )}
        {event.payload?.bookingRef && (
          <p className="text-xs text-gray-500 mt-0.5 font-mono">{event.payload.bookingRef}</p>
        )}
      </div>
    </div>
  );
};

// ── Notification panel ────────────────────────────────────────────────────────
const NotifPanel = ({ notifs, onMarkAll, onClose }) => (
  <div className="absolute right-0 top-10 z-50 w-80 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl animate-fade-in">
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
      <span className="text-sm font-semibold text-white">Notifications</span>
      <button onClick={onMarkAll} className="text-xs text-gray-500 hover:text-white transition-colors">
        Mark all read
      </button>
    </div>
    <div className="max-h-80 overflow-y-auto divide-y divide-gray-800">
      {notifs.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-8">No notifications</p>
      ) : notifs.slice(0, 20).map((n, i) => {
        const meta = EVENT_META[n.type] ?? EVENT_META.system_info;
        return (
          <div key={i} className={`px-4 py-3 ${n.unread ? 'bg-gray-800/40' : ''}`}>
            <div className="flex items-center gap-2 mb-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${n.unread ? meta.dot : 'bg-gray-700'}`} />
              <span className="text-xs font-medium text-gray-300">{meta.label}</span>
              <span className="text-[10px] text-gray-600 ml-auto">
                {dayjs(n.ts).format('HH:mm')}
              </span>
            </div>
            {n.payload?.message && (
              <p className="text-xs text-gray-500 pl-3.5 truncate">{n.payload.message}</p>
            )}
          </div>
        );
      })}
    </div>
    <div className="px-4 py-2 border-t border-gray-800">
      <button onClick={onClose} className="text-xs text-gray-600 hover:text-white w-full text-center transition-colors">
        Close
      </button>
    </div>
  </div>
);

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [health,       setHealth]       = useState(null);
  const [healthError,  setHealthError]  = useState(false);
  const [bookings,     setBookings]     = useState([]);
  const [feed,         setFeed]         = useState([]);      // live activity
  const [newIds,       setNewIds]       = useState(new Set()); // for slide-in animation
  const [notifs,       setNotifs]       = useState([]);
  const [showNotifs,   setShowNotifs]   = useState(false);
  const feedRef = useRef(null);

  // ── Load health + bookings on mount ────────────────────────────────────────
  useEffect(() => {
    getHealth()
      .then(r => setHealth(r.data))
      .catch(() => setHealthError(true));

    getAllBookings()
      .then(r => setBookings(r.data.data.bookings ?? []))
      .catch(() => {});
  }, []);

  // ── SSE handler ────────────────────────────────────────────────────────────
  const handleEvent = useCallback((event) => {
    const id = `${event.type}-${event.ts}`;

    setFeed(prev => {
      const next = [{ ...event, id }, ...prev].slice(0, 50);
      return next;
    });

    setNewIds(prev => {
      const next = new Set(prev);
      next.add(id);
      setTimeout(() => setNewIds(s => { const c = new Set(s); c.delete(id); return c; }), 600);
      return next;
    });

    // Only alert-worthy types go to notification center
    const alertTypes = ['booking_created', 'booking_cancelled', 'system_error'];
    if (alertTypes.includes(event.type)) {
      setNotifs(prev => [{ ...event, unread: true }, ...prev].slice(0, 50));
    }
  }, []);

  useSSE(handleEvent);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const today       = dayjs().format('YYYY-MM-DD');
  const todayCount  = bookings.filter(b => dayjs(b.startISO).format('YYYY-MM-DD') === today).length;
  const weekCount   = bookings.filter(b => dayjs(b.startISO).isAfter(dayjs().startOf('week'))).length;
  const unreadCount = notifs.filter(n => n.unread).length;

  const markAllRead = () => setNotifs(prev => prev.map(n => ({ ...n, unread: false })));

  return (
    <div className="relative">

      {/* ── Top bar ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white mb-0.5">Dashboard</h1>
          <p className="text-sm text-gray-500">BookBot MainMenu — system overview</p>
        </div>

        {/* Notification bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifs(v => !v)}
            className="relative p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Bell size={18} className="text-gray-400" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {showNotifs && (
            <NotifPanel
              notifs={notifs}
              onMarkAll={markAllRead}
              onClose={() => setShowNotifs(false)}
            />
          )}
        </div>
      </div>

      {healthError && (
        <div className="mb-6 bg-rose-950 border border-rose-800 text-rose-400 text-sm rounded-lg px-4 py-3">
          ⚠️ Could not reach the backend server. Make sure it is running on port 3000.
        </div>
      )}

      {/* ── Stat cards ── */}
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
          label="WhatsApp API"
          value={health?.services?.whatsapp?.configured ? '🟢 Ready' : '🔴 Missing'}
          sub={health?.services?.whatsapp?.apiVersion}
          accent="amber"
        />
      </div>

      {/* ── Two-column: live feed + service config ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Live Activity Feed — 3 cols */}
        <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded-xl flex flex-col" style={{ minHeight: '320px' }}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <Zap size={15} className="text-amber-400" />
              <span className="text-sm font-semibold text-white">Live Activity</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
              <span className="text-xs text-gray-500">live</span>
            </div>
          </div>
          <div ref={feedRef} className="flex-1 overflow-y-auto px-5 py-2">
            {feed.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                <Zap size={24} className="text-gray-700 mb-2" />
                <p className="text-xs text-gray-600">Waiting for activity…</p>
                <p className="text-xs text-gray-700 mt-1">Events appear here in real time</p>
              </div>
            ) : (
              feed.map((e) => (
                <FeedItem key={e.id} event={e} animate={newIds.has(e.id)} />
              ))
            )}
          </div>
        </div>

        {/* Service config — 2 cols */}
        <div className="lg:col-span-2 flex flex-col gap-4">

          {/* Quick stats */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={15} className="text-brand-400" />
              <span className="text-sm font-semibold text-white">Upcoming Bookings</span>
            </div>
            <div className="space-y-2">
              {bookings.length === 0 ? (
                <p className="text-xs text-gray-600 py-2">No upcoming bookings</p>
              ) : bookings.slice(0, 4).map(b => (
                <div key={b.bookingRef} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-gray-400">{b.bookingRef}</span>
                  <span className="text-gray-500 truncate max-w-[120px] text-right">
                    {dayjs(b.startISO).format('D MMM, h:mm A')}
                  </span>
                </div>
              ))}
              {bookings.length > 4 && (
                <p className="text-xs text-gray-600 pt-1">+{bookings.length - 4} more</p>
              )}
            </div>
          </div>

          {/* Service config */}
          {health && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex-1">
              <div className="flex items-center gap-2 mb-4">
                <Server size={15} className="text-purple-400" />
                <span className="text-sm font-semibold text-white">Configuration</span>
              </div>
              <div className="space-y-2.5 text-xs">
                <ConfigRow label="Working Hours" value={health.services.driver.workingHours} />
                <ConfigRow label="Min Slot"      value={`${health.services.driver.minSlotMinutes} min`} />
                <ConfigRow label="Timezone"      value={health.services.driver.timezone} />
                <ConfigRow label="Memory"        value={`${health.memory.heapUsedMB} / ${health.memory.heapTotalMB} MB`} />
                <ConfigRow label="WA Version"    value={health.services.whatsapp.apiVersion} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ConfigRow = ({ label, value }) => (
  <div className="flex justify-between border-b border-gray-800/60 pb-2 last:border-0 last:pb-0">
    <span className="text-gray-500">{label}</span>
    <span className="text-gray-300 font-mono">{value}</span>
  </div>
);