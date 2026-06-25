import React, { useState } from 'react';
import { checkAvailability } from '../api.js';
import { CalendarCheck, Clock, Loader } from 'lucide-react';
import dayjs from 'dayjs';

export default function Availability() {
  const [date,    setDate]    = useState(dayjs().format('YYYY-MM-DD'));
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const check = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await checkAvailability(date);
      setResult(res.data.data);
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Failed to fetch availability.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold text-white mb-1">Availability</h1>
      <p className="text-sm text-gray-500 mb-6">Check the driver's free slots for any date.</p>

      {/* Date picker */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5">
        <label className="block text-sm text-gray-400 mb-2">Select Date</label>
        <div className="flex gap-3">
          <input
            type="date"
            value={date}
            min={dayjs().format('YYYY-MM-DD')}
            onChange={e => setDate(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
          />
          <button
            onClick={check}
            disabled={loading}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? <Loader size={15} className="animate-spin" /> : <CalendarCheck size={15} />}
            Check
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-950 border border-red-800 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-1">{result.dateDisplay}</h2>
          <p className="text-xs text-gray-500 mb-4">
            {result.hasSlots ? `${result.slotCount} slot(s) available` : 'No available slots'}
          </p>

          {result.hasSlots ? (
            <div className="space-y-2">
              {result.slots.map((slot, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-2 text-sm text-white">
                    <Clock size={14} className="text-brand-500" />
                    {slot.display}
                  </div>
                  <span className="text-xs text-gray-400">{slot.durationMinutes} min</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-6">
              Driver is fully booked or working hours have passed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
