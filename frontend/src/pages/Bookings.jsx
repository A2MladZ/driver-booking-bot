import React, { useState, useEffect, useMemo } from 'react';
import { getBookings, getAllBookings, cancelBooking, createBooking } from '../api.js';
import {
  Search, Trash2, Plus, Loader, X, RefreshCw,
  Download, CheckSquare, Square, Filter, ChevronDown,
} from 'lucide-react';
import dayjs from 'dayjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

const Badge = ({ children, color = 'green' }) => (
  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-${color}-900 text-${color}-400`}>
    {children}
  </span>
);

const Input = ({ label, ...props }) => (
  <div>
    {label && <label className="block text-xs text-gray-400 mb-1">{label}</label>}
    <input
      {...props}
      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500 placeholder-gray-600"
    />
  </div>
);

const exportCSV = (rows) => {
  const header = 'Ref,Customer,Phone,Slot,Start,End';
  const lines  = rows.map(b =>
    [b.bookingRef, b.customerName, b.customerPhone, b.displaySlot, b.startISO, b.endISO]
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `bookings-${dayjs().format('YYYY-MM-DD')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Bookings() {
  const [phone,      setPhone]      = useState('');
  const [bookings,   setBookings]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showForm,   setShowForm]   = useState(false);
  const [mode,       setMode]       = useState('all');
  const [selected,   setSelected]   = useState(new Set());
  const [showFilter, setShowFilter] = useState(false);

  // ── Filters ──────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo:   '',
    refSearch: '',
  });
  const setFilter = (k, v) => setFilters(prev => ({ ...prev, [k]: v }));

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    setError('');
    setMode('all');
    setSelected(new Set());
    try {
      const res = await getAllBookings();
      setBookings(res.data.data.bookings);
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Failed to fetch bookings.');
    } finally {
      setLoading(false);
    }
  };

  const search = async () => {
    if (!phone.trim()) { loadAll(); return; }
    setLoading(true);
    setError('');
    setMode('search');
    setSelected(new Set());
    try {
      const res = await getBookings(phone.trim(), true);
      setBookings(res.data.data.bookings);
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Failed to fetch bookings.');
    } finally {
      setLoading(false);
    }
  };

  // ── Filtered view ─────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    return bookings.filter(b => {
      if (filters.refSearch && !b.bookingRef.toLowerCase().includes(filters.refSearch.toLowerCase()))
        return false;
      if (filters.dateFrom && dayjs(b.startISO).isBefore(dayjs(filters.dateFrom), 'day'))
        return false;
      if (filters.dateTo && dayjs(b.startISO).isAfter(dayjs(filters.dateTo), 'day'))
        return false;
      return true;
    });
  }, [bookings, filters]);

  // ── Selection ─────────────────────────────────────────────────────────────
  const allSelected  = visible.length > 0 && selected.size === visible.length;
  const toggleAll    = () => setSelected(allSelected ? new Set() : new Set(visible.map(b => b.bookingRef)));
  const toggleOne    = (ref) => setSelected(prev => {
    const next = new Set(prev);
    next.has(ref) ? next.delete(ref) : next.add(ref);
    return next;
  });

  // ── Cancel single ─────────────────────────────────────────────────────────
  const handleCancel = async (ref) => {
    if (!confirm(`Cancel booking ${ref}?`)) return;
    try {
      await cancelBooking(ref);
      setBookings(prev => prev.filter(b => b.bookingRef !== ref));
      setSelected(prev => { const n = new Set(prev); n.delete(ref); return n; });
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Failed to cancel booking.');
    }
  };

  // ── Bulk cancel ───────────────────────────────────────────────────────────
  const handleBulkCancel = async () => {
    if (!confirm(`Cancel ${selected.size} booking(s)?`)) return;
    const refs = [...selected];
    for (const ref of refs) {
      try { await cancelBooking(ref); } catch { /* continue */ }
    }
    setBookings(prev => prev.filter(b => !refs.includes(b.bookingRef)));
    setSelected(new Set());
  };

  const activeFilterCount = [filters.dateFrom, filters.dateTo, filters.refSearch].filter(Boolean).length;

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Bookings</h1>
        <div className="flex gap-2">
          <button onClick={loadAll}
            className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => exportCSV(selected.size > 0 ? visible.filter(b => selected.has(b.bookingRef)) : visible)}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-3 py-2 rounded-lg transition-colors"
          >
            <Download size={14} />
            Export{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors">
            <Plus size={15} /> New
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        {mode === 'all'
          ? `${visible.length} booking${visible.length !== 1 ? 's' : ''}`
          : `Results for ${phone}`}
      </p>

      {/* ── Search + filter bar ── */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Filter by phone… (blank = all)"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          className="flex-1 bg-gray-900 border border-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500 placeholder-gray-600"
        />
        <button onClick={search} disabled={loading}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          {loading ? <Loader size={15} className="animate-spin" /> : <Search size={15} />}
        </button>
        <button
          onClick={() => setShowFilter(v => !v)}
          className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg transition-colors border ${
            activeFilterCount > 0
              ? 'bg-brand-950 border-brand-700 text-brand-400'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
          }`}
        >
          <Filter size={14} />
          {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filter'}
          <ChevronDown size={12} className={`transition-transform ${showFilter ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Advanced filter panel */}
      {showFilter && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in">
          <Input label="Ref search" placeholder="BK-..."
            value={filters.refSearch} onChange={e => setFilter('refSearch', e.target.value)} />
          <Input label="Date from" type="date"
            value={filters.dateFrom} onChange={e => setFilter('dateFrom', e.target.value)} />
          <Input label="Date to" type="date"
            value={filters.dateTo} onChange={e => setFilter('dateTo', e.target.value)} />
          <button
            onClick={() => setFilters({ dateFrom: '', dateTo: '', refSearch: '' })}
            className="sm:col-span-3 text-xs text-gray-500 hover:text-white text-left transition-colors"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-rose-950 border border-rose-800 rounded-xl px-4 py-3 mb-4 animate-fade-in">
          <span className="text-sm text-rose-300">{selected.size} selected</span>
          <button onClick={handleBulkCancel}
            className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ml-auto">
            <Trash2 size={13} /> Cancel selected
          </button>
          <button onClick={() => setSelected(new Set())}
            className="text-rose-500 hover:text-rose-300 transition-colors">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-rose-950 border border-rose-800 text-rose-400 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader size={20} className="animate-spin text-gray-500" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-gray-600 text-sm">
          {mode === 'search' ? 'No bookings found for this number.' : 'No bookings match the current filters.'}
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Column header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
            <button onClick={toggleAll} className="shrink-0">
              {allSelected
                ? <CheckSquare size={15} className="text-brand-500" />
                : <Square size={15} className="text-gray-600" />}
            </button>
            <span className="flex-1">Booking</span>
            <span className="hidden sm:block w-48">Slot</span>
            <span className="hidden md:block w-36">Customer</span>
            <span className="w-8" />
          </div>

          {/* Rows */}
          {visible.map(b => (
            <div
              key={b.bookingRef}
              className={`flex items-center gap-3 px-4 py-3.5 border-b border-gray-800 last:border-0 transition-colors ${
                selected.has(b.bookingRef) ? 'bg-brand-950/30' : 'hover:bg-gray-800/40'
              }`}
            >
              <button onClick={() => toggleOne(b.bookingRef)} className="shrink-0">
                {selected.has(b.bookingRef)
                  ? <CheckSquare size={15} className="text-brand-500" />
                  : <Square size={15} className="text-gray-600" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-white">{b.bookingRef}</span>
                  <Badge>confirmed</Badge>
                </div>
              </div>
              <div className="hidden sm:block w-48 text-sm text-gray-300 truncate">
                {b.displaySlot}
              </div>
              <div className="hidden md:block w-36 text-xs text-gray-500 truncate">
                {b.customerName}
              </div>
              <button onClick={() => handleCancel(b.bookingRef)}
                className="p-1.5 text-gray-600 hover:text-rose-400 hover:bg-rose-950 rounded-lg transition-colors">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showForm && (
        <CreateBookingModal
          onClose={() => setShowForm(false)}
          onCreated={(b) => { setShowForm(false); setBookings(prev => [b, ...prev]); }}
        />
      )}
    </div>
  );
}

// ── Create Booking Modal ──────────────────────────────────────────────────────

function CreateBookingModal({ onClose, onCreated }) {
  const tomorrow = dayjs().add(1, 'day');
  const [form, setForm] = useState({
    customerPhone: '',
    customerName:  '',
    date:          tomorrow.format('YYYY-MM-DD'),
    startTime:     '08:00',
    endTime:       '09:00',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      const startISO = dayjs(`${form.date}T${form.startTime}`).toISOString();
      const endISO   = dayjs(`${form.date}T${form.endTime}`).toISOString();
      const res = await createBooking({
        customerPhone: form.customerPhone,
        customerName:  form.customerName || 'Admin Booking',
        startISO,
        endISO,
      });
      onCreated(res.data.data.booking);
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Failed to create booking.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">New Booking</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <Input label="Customer Phone" placeholder="919876543210"
            value={form.customerPhone} onChange={e => set('customerPhone', e.target.value)} />
          <Input label="Customer Name (optional)" placeholder="John Doe"
            value={form.customerName} onChange={e => set('customerName', e.target.value)} />
          <Input label="Date" type="date" min={dayjs().format('YYYY-MM-DD')}
            value={form.date} onChange={e => set('date', e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Time" type="time"
              value={form.startTime} onChange={e => set('startTime', e.target.value)} />
            <Input label="End Time" type="time"
              value={form.endTime} onChange={e => set('endTime', e.target.value)} />
          </div>
        </div>
        {error && (
          <div className="mt-3 bg-rose-950 border border-rose-800 text-rose-400 text-xs rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors">
            {loading && <Loader size={14} className="animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}