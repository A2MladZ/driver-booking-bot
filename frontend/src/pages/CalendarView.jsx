import React, { useState, useEffect, useCallback } from 'react';
import { getAllBookings } from '../api.js';
import { ChevronLeft, ChevronRight, Loader } from 'lucide-react';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(isoWeek);
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

// ── Colour pool — one per booking ref (stable) ────────────────────────────────
const PILL_COLORS = [
  { bg: '#1e3a5f', border: '#3b82f6', text: '#bfdbfe' },
  { bg: '#2d1b69', border: '#8b5cf6', text: '#ddd6fe' },
  { bg: '#0f3d2e', border: '#10b981', text: '#a7f3d0' },
  { bg: '#3b1f1f', border: '#ef4444', text: '#fecaca' },
  { bg: '#2d2a0f', border: '#eab308', text: '#fef08a' },
  { bg: '#1a2e40', border: '#06b6d4', text: '#a5f3fc' },
];

const colorFor = (ref) => {
  let h = 0;
  for (let i = 0; i < ref.length; i++) h = (h * 31 + ref.charCodeAt(i)) & 0xffff;
  return PILL_COLORS[h % PILL_COLORS.length];
};

// ── Format helpers ────────────────────────────────────────────────────────────
const fmt12 = (iso) => dayjs(iso).tz(TZ).format('h:mm A');

// ── BookingPill ───────────────────────────────────────────────────────────────
function BookingPill({ booking, onClick }) {
  const c = colorFor(booking.bookingRef);
  return (
    <div
      onClick={() => onClick(booking)}
      style={{
        backgroundColor: c.bg,
        borderLeft: `3px solid ${c.border}`,
        color: c.text,
      }}
      className="rounded-md px-2 py-1 mb-1 cursor-pointer text-xs leading-tight hover:brightness-125 transition-all select-none"
    >
      <div className="font-semibold truncate">{booking.customerName?.split(' ')[0] ?? 'Customer'}</div>
      <div style={{ color: c.border }} className="truncate">
        {fmt12(booking.startISO)} – {fmt12(booking.endISO)}
      </div>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function BookingModal({ booking, onClose }) {
  if (!booking) return null;
  const c = colorFor(booking.bookingRef);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#111318] border border-gray-800 rounded-2xl w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Booking</p>
            <p
              className="font-mono text-lg font-bold"
              style={{ color: c.border }}
            >
              {booking.bookingRef}
            </p>
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium mt-1"
            style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
          >
            confirmed
          </span>
        </div>

        <dl className="space-y-3 text-sm">
          <Row label="Slot"     value={booking.displaySlot} />
          <Row label="Customer" value={booking.customerName} />
          <Row label="Phone"    value={booking.customerPhone} mono />
        </dl>

        <button
          onClick={onClose}
          className="mt-6 w-full bg-gray-800 hover:bg-gray-700 text-white text-sm py-2.5 rounded-xl transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex gap-3">
      <dt className="text-gray-500 w-20 shrink-0">{label}</dt>
      <dd className={`text-gray-200 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

// ── Main CalendarView ─────────────────────────────────────────────────────────
export default function CalendarView() {
  const [weekStart, setWeekStart] = useState(() =>
    dayjs().tz(TZ).startOf('isoWeek')   // Mon
  );
  const [bookings, setBookings]   = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState('');
  const [selected, setSelected]   = useState(null);

  // Sun–Sat display (7 days from Mon-1 = Sun, or keep Mon–Sun)
  // Using Mon–Sun to match ISO week
  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const timeMin = weekStart.toISOString();
      const timeMax = weekStart.add(7, 'day').toISOString();
      const res = await getAllBookings(timeMin, timeMax);
      setBookings(res.data.data.bookings);
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Failed to load bookings.');
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  const bookingsForDay = (day) =>
    bookings.filter(b => dayjs(b.startISO).tz(TZ).isSame(day, 'day'));

  const isToday = (day) => day.isSame(dayjs().tz(TZ), 'day');

  const prevWeek = () => setWeekStart(w => w.subtract(1, 'week'));
  const nextWeek = () => setWeekStart(w => w.add(1, 'week'));
  const goToday  = () => setWeekStart(dayjs().tz(TZ).startOf('isoWeek'));

  const weekLabel = `${weekStart.format('D MMM')} – ${weekStart.add(6, 'day').format('D MMM YYYY')}`;
  const monthLabel = weekStart.format('MMMM YYYY').toUpperCase();
  const totalThisWeek = bookings.length;

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Top bar ── */}
      <div className="flex items-end justify-between mb-6">
        <div>
          {/* Big title like the screenshot */}
          <h1
            className="text-5xl font-black tracking-tight text-white uppercase leading-none"
            style={{ fontStretch: 'expanded', letterSpacing: '-0.02em' }}
          >
            Weekly Planner
          </h1>
          <div className="flex items-center gap-4 mt-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              {monthLabel}
            </span>
            <span className="text-xs text-gray-600">{weekLabel}</span>
            {totalThisWeek > 0 && (
              <span className="text-xs text-brand-400">
                {totalThisWeek} booking{totalThisWeek !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Nav controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            Today
          </button>
          <button
            onClick={prevWeek}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={nextWeek}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* ── Calendar grid ── */}
      <div className="flex-1 min-h-0 border border-gray-800 rounded-xl overflow-hidden bg-gray-950">

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-800">
          {days.map((day, i) => (
            <div
              key={i}
              className={`py-3 px-2 text-center border-r border-gray-800 last:border-r-0 ${
                isToday(day) ? 'bg-brand-950/40' : ''
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                {day.format('ddd')}
              </p>
              <p
                className={`text-2xl font-black leading-tight mt-0.5 ${
                  isToday(day) ? 'text-brand-400' : 'text-white'
                }`}
              >
                {day.format('D')}
              </p>
            </div>
          ))}
        </div>

        {/* Booking cells */}
        <div className="grid grid-cols-7 h-full" style={{ minHeight: '420px' }}>
          {days.map((day, i) => {
            const dayBookings = bookingsForDay(day);
            return (
              <div
                key={i}
                className={`border-r border-gray-800 last:border-r-0 p-2 overflow-y-auto ${
                  isToday(day) ? 'bg-brand-950/20' : ''
                }`}
                style={{ minHeight: '420px', maxHeight: 'calc(100vh - 320px)' }}
              >
                {loading ? (
                  <div className="flex justify-center pt-4">
                    <Loader size={14} className="animate-spin text-gray-700" />
                  </div>
                ) : dayBookings.length === 0 ? (
                  <div className="h-full flex items-start justify-center pt-6">
                    <span className="text-[10px] text-gray-800 select-none">—</span>
                  </div>
                ) : (
                  dayBookings.map(b => (
                    <BookingPill
                      key={b.bookingRef}
                      booking={b}
                      onClick={setSelected}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail modal */}
      <BookingModal booking={selected} onClose={() => setSelected(null)} />
    </div>
  );
}