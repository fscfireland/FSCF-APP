// Where the phone is when a door is inspected or a photo taken.
// Indoors this usually comes from Wi-Fi / mobile masts rather than GPS
// satellites, so expect roughly 10–50 m accuracy: enough to show you were on
// site, not which room. Returns null if location is unavailable or refused.

let last = null;
let lastError = '';

export const geoError = () => lastError;

export function getPosition({ timeout = 10000, maxAge = 60000 } = {}) {
  if (last && Date.now() - Date.parse(last.at) < maxAge) return Promise.resolve(last);
  if (!navigator.geolocation) {
    lastError = 'This device or browser cannot give a location.';
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    setTimeout(() => {
      lastError = lastError || 'Location took too long to find.';
      finish(null);
    }, timeout + 1000);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          last = {
            lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
            lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
            acc: Math.round(pos.coords.accuracy || 0),
            at: new Date(pos.timestamp || Date.now()).toISOString(),
          };
          lastError = '';
          finish(last);
        },
        (err) => {
          lastError = err?.code === 1 ? 'Location access is turned off for this app.' : 'Location could not be found here.';
          finish(null);
        },
        { enableHighAccuracy: true, timeout, maximumAge: maxAge }
      );
    } catch {
      lastError = 'Location is not available here.';
      finish(null);
    }
  });
}

export const gpsText = (g) => (g ? `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} (±${g.acc} m)` : '');
export const mapLink = (g) => (g ? `https://www.google.com/maps?q=${g.lat},${g.lng}` : '');
