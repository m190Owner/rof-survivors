// Global leaderboard client. Talks to ./leaderboard.php (served alongside the
// game at /game/), so the same relative path works in dev preview and on the
// live site. All calls fail soft: if the backend is missing (e.g. `vite dev`,
// which has no PHP), callers get null/an error and the UI shows "unavailable".

const ENDPOINT = 'leaderboard.php';
const NAME_KEY = 'rof_lb_name';

// Fetch the top entries. Returns an array, or null if the board is unreachable.
export async function fetchBoard() {
  try {
    const res = await fetch(ENDPOINT, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.leaderboard) ? data.leaderboard : null;
  } catch {
    return null;
  }
}

// Submit a run. Returns { ok:true, your_rank, leaderboard } on success, or
// { ok:false, error } on a handled rejection (bad name, rate limit, offline).
export async function submitScore({ name, time, kills, level }) {
  try {
    const body = new URLSearchParams({
      name,
      time: String(Math.max(0, Math.floor(time))),
      kills: String(Math.max(0, Math.floor(kills))),
      level: String(Math.max(1, Math.floor(level))),
    });
    const res = await fetch(ENDPOINT, { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `submit failed (${res.status})` };
    }
    return data;
  } catch {
    return { ok: false, error: 'leaderboard offline' };
  }
}

// Remember the last name the player used so we can prefill it next time.
export function getSavedName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
export function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}
