// End of service: the close-out questions that must be answered before a
// service is closed, the client's signed declaration sheet, and the weather
// on each inspection day (Met Éireann). Closing saves the finished report into Files.

import * as db from './db.js';

export const DEFAULT_CLOSE_QUESTIONS = [
  'Are fire compartment drawings available on site?',
  'Are the fire safety certificate (FSC) drawings available?',
  'Are fire door certificates / test evidence (e.g. Certifire, BM TRADA) available?',
  'Are O&M manuals for the doors and ironmongery available?',
  'Is a previous fire door inspection report available?',
  'Is a fire door register / asset list kept on site?',
  'Were all doors on the schedule accessed?',
  'Are any fire doors wedged or held open without an approved hold-open device?',
  'Do hold-open devices release on fire alarm activation?',
  'Has the client been told today of any high-risk defects found?',
  'Were all doors left safe and in working order at the end of the visit?',
  'Has the client signed the declaration sheet?',
];

export const CLOSE_ANSWERS = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
  { id: 'na', label: 'N/A' },
];

export const closeQuestions = (lists) => (lists.closeQuestions?.length ? lists.closeQuestions : DEFAULT_CLOSE_QUESTIONS);

// One close-out per collection (monthly service, etc.); '' when there's none.
export const closeKey = (coll) => (coll == null || coll === '*' ? '' : coll);
export const closeoutOf = (project, coll) => project.closeouts?.[closeKey(coll)] || null;

// ---------- Live services: Start service -> End service (close-out) ----------
export const serviceOf = (project, coll) => project.services?.[closeKey(coll)] || null;
export const isLive = (project, key) => !!project.services?.[key] && !project.closeouts?.[key];
export const liveKeys = (project) => Object.keys(project.services || {}).filter((k) => isLive(project, k));

export async function startService(projectId, coll, by) {
  const p = await db.get('projects', projectId);
  const services = { ...(p.services || {}), [closeKey(coll)]: { startedAt: new Date().toISOString(), startedBy: by || '' } };
  return db.put('projects', { ...p, services });
}

export async function saveCloseout(projectId, coll, rec) {
  const p = await db.get('projects', projectId);
  const closeouts = { ...(p.closeouts || {}) };
  if (rec) closeouts[closeKey(coll)] = rec;
  else delete closeouts[closeKey(coll)];
  return db.put('projects', { ...p, closeouts });
}

// ---------- Weather (Met Éireann open data: free, commercial use allowed) ----------
// Met Éireann only gives forecasts, not past weather. So the app records the
// weather while you're on site: each time you work on a project (at most every
// 3 hours, as the service asks) it saves today's hour-by-hour conditions for
// the site. Close-out then summarises the recorded days.
const MET_URL = 'https://openaccess.pf.api.met.ie/metno-wdb2ts/locationforecast';
export const WEATHER_SOURCE = 'Met Éireann';
export const WEATHER_CREDIT = 'Weather: Copyright Met Éireann. Source www.met.ie. Data under the Met Éireann open data licence (CC BY 4.0). Recorded from the Met Éireann forecast for the site on the day; Met Éireann accepts no liability for the data.';
const REFRESH_MS = 3 * 3600e3;

const SYMBOLS = {
  Sun: 'Sunny', LightCloud: 'Mainly clear', PartlyCloud: 'Partly cloudy', Cloud: 'Cloudy', Fog: 'Fog',
  LightRainSun: 'Light showers', RainSun: 'Showers', LightRain: 'Light rain', Rain: 'Rain', Drizzle: 'Drizzle', DrizzleSun: 'Drizzle showers',
  SleetSun: 'Sleet showers', Sleet: 'Sleet', LightSleet: 'Light sleet', SnowSun: 'Snow showers', Snow: 'Snow', LightSnow: 'Light snow',
  RainThunder: 'Rain and thunder', LightRainThunder: 'Rain and thunder', RainThunderSun: 'Thundery showers', LightRainThunderSun: 'Thundery showers',
  DrizzleThunder: 'Drizzle and thunder', SleetThunder: 'Sleet and thunder', SnowThunder: 'Snow and thunder',
};
const symText = (id) => SYMBOLS[id] || String(id || '').replace(/^Dark_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase());
// rough order of "how bad", to pick the day's headline conditions
const SEVERITY = ['Thunder', 'Snow', 'Sleet', 'Rain', 'Drizzle', 'Fog', 'Cloud', 'PartlyCloud', 'LightCloud', 'Sun'];
const sevOf = (id = '') => { const k = SEVERITY.findIndex((w) => id.includes(w)); return k < 0 ? 99 : k; };

const dublin = (iso) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour };
};
export const todayDublin = () => dublin(new Date().toISOString()).date;

// Where the site is: GPS stamped on doors, a saved site position, or the phone.
export async function siteLocation(project, doors, getPhone) {
  const g = doors.map((d) => d.gps).filter((x) => x && isFinite(x.lat) && isFinite(x.lng));
  if (g.length) return { lat: g.reduce((a, x) => a + x.lat, 0) / g.length, lng: g.reduce((a, x) => a + x.lng, 0) / g.length, place: 'site (door GPS)' };
  if (project.siteGps) return { ...project.siteGps, place: 'site' };
  const ph = getPhone ? await getPhone() : null;
  if (ph) {
    const p = await db.get('projects', project.id);
    await db.put('projects', { ...p, siteGps: { lat: ph.lat, lng: ph.lng } });
    return { lat: ph.lat, lng: ph.lng, place: 'site (phone location)' };
  }
  return null;
}

// Hour-by-hour values for one place, keyed by Irish date then hour.
export async function fetchMetEireann(lat, lng) {
  const r = await fetch(`${MET_URL}?lat=${lat.toFixed(4)};long=${lng.toFixed(4)}`);
  if (!r.ok) throw new Error('Met Éireann weather service error ' + r.status);
  const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
  const out = {};
  const slot = (iso) => { const { date, hour } = dublin(iso); return ((out[date] ||= {})[hour] ||= {}); };
  for (const t of xml.querySelectorAll('time')) {
    const from = t.getAttribute('from');
    const to = t.getAttribute('to');
    const loc = t.querySelector('location');
    if (!loc || !from) continue;
    if (from === to) {
      const h = slot(from);
      const v = (sel, attr = 'value') => { const e = loc.querySelector(sel); const n = e ? parseFloat(e.getAttribute(attr)) : NaN; return isFinite(n) ? n : undefined; };
      h.t = v('temperature');
      const ws = v('windSpeed', 'mps');
      if (ws != null) h.wind = Math.round(ws * 3.6);
      const gs = v('windGust', 'mps');
      if (gs != null) h.gust = Math.round(gs * 3.6);
    } else if (Date.parse(to) - Date.parse(from) <= 3600e3) {
      const h = slot(from);
      const pr = loc.querySelector('precipitation');
      if (pr) h.rain = parseFloat(pr.getAttribute('value')) || 0;
      const sy = loc.querySelector('symbol');
      if (sy) h.sym = sy.getAttribute('id');
    }
  }
  return out;
}

let lastTry = 0;
// Record today's weather for the project (quietly; does nothing offline,
// without a location, or if it was recorded in the last 3 hours).
export async function recordWeather(projectId, doors, getPhone, { force = false } = {}) {
  if (!force && Date.now() - lastTry < 60e3) return null;
  lastTry = Date.now();
  const project = await db.get('projects', projectId);
  if (!project) return null;
  const today = todayDublin();
  const log = project.weatherLog || {};
  if (!force && log[today] && Date.now() - Date.parse(log[today].fetchedAt) < REFRESH_MS) return log[today];
  const loc = await siteLocation(project, doors, getPhone);
  if (!loc) throw new Error('No site location yet. Stamp GPS on a door, or allow location.');
  const hours = await fetchMetEireann(loc.lat, loc.lng);
  const nowHour = dublin(new Date().toISOString()).hour;
  const p = await db.get('projects', projectId);
  const weatherLog = { ...(p.weatherLog || {}) };
  const prev = weatherLog[today]?.hours || {};
  // keep earlier hours as first recorded (closest to what happened); take the newest forecast for the rest
  const merged = { ...(hours[today] || {}) };
  for (const [h, v] of Object.entries(prev)) if (h < nowHour) merged[h] = v;
  weatherLog[today] = { place: loc.place, lat: loc.lat, lng: loc.lng, fetchedAt: new Date().toISOString(), hours: merged };
  await db.put('projects', { ...p, weatherLog });
  return weatherLog[today];
}

// Daily summary of the working day (08:00–18:00) from a recorded day.
export function daySummary(date, rec) {
  if (!rec?.hours) return { date, text: '' };
  const hrs = Object.entries(rec.hours).filter(([h]) => h >= '08' && h <= '18').map(([, v]) => v);
  const use = hrs.length ? hrs : Object.values(rec.hours);
  const temps = use.map((v) => v.t).filter((n) => n != null);
  const syms = use.map((v) => v.sym).filter(Boolean);
  const worst = syms.sort((a, b) => sevOf(a) - sevOf(b))[0];
  const max = (k) => { const a = use.map((v) => v[k]).filter((n) => n != null); return a.length ? Math.max(...a) : null; };
  const rain = use.reduce((a, v) => a + (v.rain || 0), 0);
  return {
    date,
    text: worst ? symText(worst) : '',
    tmin: temps.length ? Math.min(...temps) : null,
    tmax: temps.length ? Math.max(...temps) : null,
    rain: use.some((v) => v.rain != null) ? rain : null,
    wind: max('wind'),
    gust: max('gust'),
  };
}

export const weatherDays = (project, dates) => dates.map((d) => daySummary(d, project.weatherLog?.[d]));

const n0 = (v) => (v == null || v === '' ? '' : Math.round(v));
export function weatherLine(w) {
  if (w.manual) return w.manual;
  if (!w.text && w.tmax == null) return '';
  return [w.text, w.tmax != null ? `${n0(w.tmin)}–${n0(w.tmax)} °C` : '', w.rain != null ? `rain ${(+w.rain).toFixed(1)} mm` : '', w.wind != null ? `wind ${n0(w.wind)} km/h${w.gust != null ? ` (gusts ${n0(w.gust)})` : ''}` : '']
    .filter(Boolean).join(' · ');
}

export function inspectionDates(doors) {
  const ds = [...new Set(doors.map((d) => d.inspectedOn).filter(Boolean))].sort();
  return ds.length ? ds : [new Date().toISOString().slice(0, 10)];
}
