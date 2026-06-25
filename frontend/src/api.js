import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

// ── Bookings ──────────────────────────────────────────────────────────────────
export const getBookings    = (phone, includePast = false) =>
  api.get(`/bookings`, { params: { phone, includePast } });

export const getAllBookings  = (timeMin, timeMax) =>
  api.get(`/bookings/all`, { params: { timeMin, timeMax } });

export const getBooking     = (ref) =>
  api.get(`/bookings/${ref}`);

export const createBooking  = (data) =>
  api.post(`/bookings`, data);

export const cancelBooking  = (ref) =>
  api.delete(`/bookings/${ref}`);

export const checkAvailability = (date) =>
  api.post(`/bookings/availability`, { date });

// ── Health ────────────────────────────────────────────────────────────────────
export const getHealth = () =>
  axios.get('/health');

export default api;
