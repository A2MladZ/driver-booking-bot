import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  LayoutDashboard, CalendarCheck, BookOpen,
  Activity, Bot, CalendarDays, Search,
} from 'lucide-react';

import Dashboard     from './pages/Dashboard.jsx';
import Bookings      from './pages/Bookings.jsx';
import Availability  from './pages/Availability.jsx';
import Health        from './pages/Health.jsx';
import CalendarView  from './pages/CalendarView.jsx';
import CommandPalette from './components/CommandPalette.jsx';

const NAV = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard'    },
  { to: '/bookings',     icon: BookOpen,         label: 'Bookings'     },
  { to: '/calendar',     icon: CalendarDays,     label: 'Calendar'     },
  { to: '/availability', icon: CalendarCheck,    label: 'Availability' },
  { to: '/health',       icon: Activity,         label: 'Health'       },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? 'bg-[#471396] text-white'
      : 'text-[#090040] hover:bg-[#B13BFF] hover:text-white'
  }`;

export default function App() {
  const [showPalette, setShowPalette] = useState(false);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Sidebar ── */}<aside className="w-60 shrink-0 bg-[#FFCC00] border-r border-[#B13BFF] flex flex-col">
      
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-gray-800">
          <Bot className="text-[#471396]" size={24} />
          <span className="font-bold text-[#090040] text-base leading-tight">
            BookBot<br />
            <span className="text-[#471396] font-normal text-xs">MainMenu</span>
          </span>
        </div>

        {/* Search trigger */}
        <div className="px-3 pt-3">
          <button
            onClick={() => setShowPalette(true)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-[#471396] hover:bg-[#B13BFF] text-white rounded-lg text-sm transition-colors"
          >
            <Search size={14} />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="text-[10px] bg-[#090040] text-[#FFCC00] px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-1">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} className={linkClass}>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#550000] text-xs text-gray-500">
          Driver Booking Bot v1.0
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto bg-[#090040] p-6">
        <Routes>
          <Route path="/"             element={<Dashboard />}    />
          <Route path="/bookings"     element={<Bookings />}     />
          <Route path="/calendar"     element={<CalendarView />} />
          <Route path="/availability" element={<Availability />} />
          <Route path="/health"       element={<Health />}       />
          <Route path="*"             element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* ── Command Palette ── */}
      {showPalette && <CommandPalette onClose={() => setShowPalette(false)} />}

    </div>
  );
}