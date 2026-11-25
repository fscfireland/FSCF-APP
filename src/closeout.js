// End of service: the close-out questions that must be answered before a
// service is closed, the client's signed declaration sheet, and the weather
// on each inspection day. Closing saves the finished report into Files.

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

export async function saveCloseout(projectId, coll, rec) {
  const p = await db.get('projects', projectId);
  const closeouts = { ...(p.closeouts || {}) };
  if (rec) closeouts[closeKey(coll)] = rec;
  else delete closeouts[closeKey(coll)];
  return db.put('projects', { ...p, closeouts });
}

// ---------- Weather (Open-Meteo: no key needed) ----------
const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};
export const weatherText = (code) => WMO[code] ?? '';

// Where the site is: GPS stamped on doors, a saved site position, or the
// project address looked up by name (town / county).
export async function siteLocation(project, doors) {
  const g = doors.map((d) => d.gps).filter((x) => x && isFinite(x.lat) && isFinite(x.lng));
  if (g.length) {
    return { lat: g.reduce((a, x) => a + x.lat, 0) / g.length, lng: g.reduce((a, x) => a + x.lng, 0) / g.length, place: 'GPS on doors' };
  }
  if (project.siteGps) return { ...project.siteGps, place: project.siteGps.place || 'Site position' };
  const parts = [project.address, project.site].filter(Boolean).join(',').split(/[,\n]/).map((s) => s.replace(/\b(co\.?|county)\s+/i, '').trim()).filter((s) => s && !/\d/.test(s));
  for (const name of parts.reverse()) {
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&country_code=IE&language=en`);
      const j = await r.json();
      const hit = j.results?.[0];
      if (hit) return { lat: hit.latitude, lng: hit.longitude, place: [hit.name, hit.admin1].filter(Boolean).join(', ') };
    } catch {
      break; // offline: no point trying the other names
    }
  }
  return null;
}

const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max';

// Daily weather for each date (YYYY-MM-DD). Recent days come from the
// forecast service (which keeps ~3 months), older ones from the archive.
export async function fetchWeather(loc, dates) {
  const days = [...new Set(dates)].sort();
  if (!days.length) return [];
  const cut = new Date(Date.now() - 80 * 864e5).toISOString().slice(0, 10);
  const groups = [days.filter((d) => d < cut), days.filter((d) => d >= cut)];
  const out = {};
  for (const [i, group] of groups.entries()) {
    if (!group.length) continue;
    const host = i === 0 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const url = `${host}?latitude=${loc.lat.toFixed(4)}&longitude=${loc.lng.toFixed(4)}&start_date=${group[0]}&end_date=${group[group.length - 1]}&daily=${DAILY}&timezone=Europe%2FDublin&wind_speed_unit=kmh`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Weather service error ' + r.status);
    const j = await r.json();
    const dd = j.daily || {};
    (dd.time || []).forEach((t, k) => {
      if (!group.includes(t)) return;
      out[t] = {
        date: t,
        code: dd.weather_code?.[k],
        text: weatherText(dd.weather_code?.[k]),
        tmax: dd.temperature_2m_max?.[k],
        tmin: dd.temperature_2m_min?.[k],
        rain: dd.precipitation_sum?.[k],
        wind: dd.wind_speed_10m_max?.[k],
        gust: dd.wind_gusts_10m_max?.[k],
      };
    });
  }
  return days.map((d) => out[d] || { date: d, text: '' });
}

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
