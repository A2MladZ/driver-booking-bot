import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllBookings } from '../api.js';
import { Search, CalendarDays, BookOpen, LayoutDashboard, Activity, X, ArrowRight } from 'lucide-react';
import dayjs from 'dayjs';

const STATIC_ACTIONS = [
  { id: 'nav-dashboard',    label: 'Go to Dashboard',    icon: LayoutDashboard, action: 'nav', to: '/'            },
  { id: 'nav-bookings',     label: 'Go to Bookings',     icon: BookOpen,         action: 'nav', to: '/bookings'    },
  { id: 'nav-calendar',     label: 'Go to Calendar',     icon: CalendarDays,     action: 'nav', to: '/calendar'    },
  { id: 'nav-availability', label: 'Go to Availability', icon: Activity,         action: 'nav', to: '/availability'},
];

export default function CommandPalette({ onClose }) {
  const [query,    setQuery]    = useState('');
  const [bookings, setBookings] = useState([]);
  const [cursor,   setCursor]   = useState(0);
  const inputRef  = useRef(null);
  const navigate  = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
    getAllBookings()
      .then(r => setBookings(r.data.data.bookings ?? []))
      .catch(() => {});
  }, []);

  // Filter results
  const q = query.trim().toLowerCase();

  const bookingResults = q
    ? bookings.filter(b =>
        b.bookingRef.toLowerCase().includes(q) ||
        b.customerName?.toLowerCase().includes(q) ||
        b.customerPhone?.includes(q)
      ).slice(0, 6)
    : [];

  const actionResults = STATIC_ACTIONS.filter(a =>
    !q || a.label.toLowerCase().includes(q)
  );

  const allResults = [
    ...bookingResults.map(b => ({
      id:    b.bookingRef,
      label: b.bookingRef,
      sub:   `${b.customerName} · ${dayjs(b.startISO).format('D MMM, h:mm A')}`,
      icon:  CalendarDays,
      action: 'nav',
      to:    '/bookings',
    })),
    ...actionResults,
  ];

  useEffect(() => { setCursor(0); }, [query]);

  const execute = useCallback((item) => {
    if (item.action === 'nav') navigate(item.to);
    onClose();
  }, [navigate, onClose]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, allResults.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && allResults[cursor]) execute(allResults[cursor]);
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4 bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden animate-slide-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-800">
          <Search size={16} className="text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search bookings, navigate…"
            className="flex-1 bg-transparent text-white text-sm placeholder-gray-600 outline-none"
          />
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400">
            <X size={15} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1">
          {allResults.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-8">No results</p>
          ) : allResults.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => execute(item)}
                onMouseEnter={() => setCursor(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === cursor ? 'bg-gray-800' : 'hover:bg-gray-800/50'
                }`}
              >
                <div className="w-7 h-7 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
                  <Icon size={14} className="text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{item.label}</p>
                  {item.sub && <p className="text-xs text-gray-500 truncate">{item.sub}</p>}
                </div>
                {i === cursor && <ArrowRight size={13} className="text-gray-600 shrink-0" />}
              </button>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-gray-800 flex gap-4 text-[10px] text-gray-700">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
