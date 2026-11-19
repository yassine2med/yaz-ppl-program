import { useState, useEffect, useRef, Suspense, lazy } from "react";
import confetti from "canvas-confetti";
import ThemeToggle from "./components/ThemeToggle";
const HistoryChart = lazy(() => import("./components/HistoryChart"));
import { auth, cloudEnabled, loginWithGoogle, logout, syncLogToCloud, fetchLogFromCloud } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";

// ─── localStorage helpers ────────────────────────────────────────────────────
const STORAGE_KEY = "yaz-gym-log";
const WEEK_KEY    = "yaz-current-week";

function loadLog() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { console.error("loadLog err:", e); return {}; }
}
function saveLog(log) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)); } catch (e) { console.error("saveLog err:", e); }
}
function loadWeek() {
  try { return parseInt(localStorage.getItem(WEEK_KEY)) || 1; } catch (e) { console.error("loadWeek err:", e); return 1; }
}
function saveWeek(w) {
  try { localStorage.setItem(WEEK_KEY, String(w)); } catch (e) { console.error("saveWeek err:", e); }
}

function generateCalendarICS() {
  const calData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
SUMMARY:Gym - Yaz's PPL Program
DESCRIPTION:It's time to hit the gym! Let's get those gains.
DTSTART;VALUE=DATE:20230102
END:VEVENT
END:VCALENDAR`;
  const blob = new Blob([calData], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'yaz_gym_schedule.ics';
  a.click();
  URL.revokeObjectURL(url);
}

function todayKey(day) {
  return `${day}-${new Date().toISOString().slice(0, 10)}`;
}
function lastSessionKey(day, log) {
  const today = todayKey(day);
  return Object.keys(log)
    .filter(k => k.startsWith(`${day}-`) && k !== today)
    .sort()
    .at(-1) || null;
}

// plate calculator: standard barbell, returns plates per side
const PLATES = [20, 15, 10, 5, 2.5, 1.25];
function calcPlates(targetKg, barKg = 20) {
  let remaining = Math.max(0, (targetKg - barKg)) / 2;
  const result = [];
  for (const p of PLATES) {
    const count = Math.floor(remaining / p);
    if (count > 0) { result.push({ kg: p, count }); remaining -= count * p; }
  }
  return result;
}

// ─── GlobalStyles ─────────────────────────────────────────────────────────────
const GlobalStyles = () => (
  <style dangerouslySetInnerHTML={{__html: `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&family=Inter:wght@400;500;600&display=swap');

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body { margin: 0; background: var(--bg-main); color: #E2E8F0; font-family: 'Inter', sans-serif; overflow-y: scroll; }
    h1, h2, h3, .heading { font-family: 'Outfit', sans-serif; }

    .app-container {
      min-height: 100vh;
      min-height: 100dvh;
      background: radial-gradient(circle at top, #13131A 0%, var(--bg-main) 100%);
      padding-bottom: 80px;
    }

    .glass-header {
      background: rgba(7, 7, 9, 0.75);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      position: sticky;
      top: 0;
      z-index: 50;
      padding: 16px 16px 0;
    }

    .gradient-text {
      background: linear-gradient(135deg, #FFFFFF 0%, var(--text-secondary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .tabs-container {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: 2px;
      mask-image: linear-gradient(to right, black 90%, transparent 100%);
      -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%);
    }
    .tabs-container::-webkit-scrollbar { display: none; }

    .tab-btn {
      padding: 12px 18px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      position: relative;
      color: #718096;
      transition: all 0.3s ease;
      border-radius: 8px 8px 0 0;
    }
    .tab-btn:hover { color: var(--text-secondary); }
    .tab-btn.active { color: var(--active-color, #FFF); }
    .tab-btn::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0; height: 2px;
      background: var(--active-color, transparent);
      transform: scaleX(0);
      transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      box-shadow: 0 -2px 10px var(--active-color);
    }
    .tab-btn.active::after { transform: scaleX(1); }

    .week-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .week-stepper {
      width: 36px; height: 36px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      color: var(--text-secondary);
      font-size: 20px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; flex-shrink: 0;
      transition: background 0.2s;
    }
    .week-stepper:active { background: rgba(255,255,255,0.1); }

    .content-area {
      max-width: 700px;
      margin: 0 auto;
      padding: 24px 16px;
      animation: fadeIn 0.4s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ex-card {
      background: rgba(20, 20, 25, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 20px;
      margin-bottom: 16px;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    .ex-card:hover {
      background: rgba(25, 25, 32, 0.8);
      border-color: rgba(255, 255, 255, 0.08);
      transform: translateY(-2px);
      box-shadow: 0 12px 30px rgba(0,0,0,0.3);
    }
    .ex-card.done {
      background: rgba(10, 15, 10, 0.4);
      border-color: var(--active-color-dim);
    }

    .check-circle {
      width: 28px; height: 28px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.1);
      display: flex; align-items: center; justify-content: center;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      flex-shrink: 0;
    }
    .done .check-circle {
      background: var(--active-color);
      border-color: var(--active-color);
      box-shadow: 0 0 15px var(--active-color-dim);
      transform: scale(1.05);
    }

    .badge {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 11px;
      font-family: 'Outfit', sans-serif; font-weight: 600;
      display: flex; gap: 6px; align-items: center;
    }

    .expand-content {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    .expand-content.open { grid-template-rows: 1fr; }
    .expand-inner { overflow: hidden; }

    .progress-card {
      background: rgba(20, 20, 25, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px; padding: 20px; margin-bottom: 16px;
      display: flex; gap: 16px;
      transition: transform 0.3s ease;
    }
    .progress-card:hover { transform: translateX(4px); background: rgba(25, 25, 32, 0.8); }
    .progress-card.current-week {
      border-color: rgba(236, 72, 153, 0.4);
      background: rgba(236, 72, 153, 0.06);
    }
    .pct-box {
      width: 56px; height: 56px;
      border-radius: 14px;
      display: flex; align-items: center; justify-content: center;
      font-family: 'Outfit', sans-serif; font-size: 15px; font-weight: 800;
      flex-shrink: 0;
    }

    .set-log-row {
      display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
    }
    .set-label {
      font-size: 11px; font-family: 'Outfit', sans-serif; font-weight: 700;
      color: #718096; width: 32px; flex-shrink: 0;
    }
    .log-input {
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px; padding: 9px 12px;
      font-size: 16px; font-family: 'Outfit', sans-serif; font-weight: 700;
      color: var(--text-primary); width: 0; flex: 1; text-align: center;
      outline: none; -webkit-appearance: none; appearance: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .log-input:focus {
      border-color: var(--active-color, rgba(255,255,255,0.3));
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--active-color, white) 15%, transparent);
    }
    .log-input::placeholder { color: #4A5568; font-weight: 500; font-size: 13px; }
    .log-input-label {
      font-size: 10px; color: #4A5568; text-align: center;
      font-family: 'Outfit', sans-serif; font-weight: 600; letter-spacing: 0.5px;
    }
    .set-done-btn {
      width: 44px; height: 44px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.1); background: transparent;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; flex-shrink: 0;
      transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .set-done-btn.set-done {
      background: var(--active-color); border-color: var(--active-color);
      box-shadow: 0 0 12px color-mix(in srgb, var(--active-color) 50%, transparent);
    }

    .rest-timer {
      position: fixed;
      bottom: calc(24px + env(safe-area-inset-bottom));
      left: 50%; transform: translateX(-50%);
      background: rgba(10,10,14,0.95);
      backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px; padding: 16px 24px;
      display: flex; align-items: center; gap: 16px;
      z-index: 100; min-width: 240px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      animation: slideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes slideUp {
      from { transform: translateX(-50%) translateY(20px); opacity: 0; }
      to   { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    .timer-dismiss {
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px; padding: 10px 16px;
      font-size: 13px; font-family: 'Outfit', sans-serif; font-weight: 700;
      color: var(--text-secondary); cursor: pointer; white-space: nowrap;
      min-height: 44px; display: flex; align-items: center;
    }

    .plate-input {
      background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 14px; padding: 14px 18px;
      font-size: 28px; font-family: 'Outfit', sans-serif; font-weight: 800;
      color: var(--text-primary); flex: 1; text-align: center;
      outline: none; -webkit-appearance: none; appearance: none;
    }
    .plate-input:focus { border-color: #F59E0B; }
    .plate-chip {
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 10px; padding: 8px 14px;
      font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 14px;
      margin: 4px;
    }

    .hist-day-block {
      background: rgba(20,20,25,0.6); border: 1px solid rgba(255,255,255,0.05);
      border-radius: 16px; padding: 18px; margin-bottom: 16px;
    }
    .hist-ex-row {
      padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
      font-size: 13px;
    }
    .hist-ex-row:last-child { border-bottom: none; }
    .hist-set-pill {
      display: inline-block; background: rgba(255,255,255,0.05);
      border-radius: 6px; padding: 3px 8px;
      font-size: 11px; font-family: 'Outfit', sans-serif; font-weight: 600;
      margin: 2px 4px 2px 0; color: var(--text-secondary);
    }
  `}} />
);

// ─── Rest Timer ───────────────────────────────────────────────────────────────
function RestTimer({ seconds, color, onDone }) {
  const [endTime] = useState(() => Date.now() + seconds * 1000);
  const [remaining, setRemaining] = useState(seconds);
  const ref = useRef(null);

  useEffect(() => {
    function tick() {
      const left = Math.max(0, Math.round((endTime - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
          osc.start(); osc.stop(ctx.currentTime + 0.4);
        } catch (e) { console.error("Audio error", e); }
        setTimeout(onDone, 0);
        return;
      }
      ref.current = setTimeout(tick, 500);
    }
    tick();
    return () => clearTimeout(ref.current);
  }, [onDone, endTime]);

  const pct = remaining / seconds;
  const r = 22, circ = 2 * Math.PI * r;

  return (
    <div className="rest-timer">
      <svg width="52" height="52" viewBox="0 0 52 52" style={{ flexShrink: 0 }}>
        <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3"/>
        <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${circ * pct} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 26 26)" style={{ transition: 'stroke-dasharray 1s linear' }}/>
        <text x="26" y="31" textAnchor="middle" fill="var(--text-primary)" fontSize="14" fontFamily="Outfit" fontWeight="800">{remaining}</text>
      </svg>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Outfit' }}>Rest</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Next set in {remaining}s</div>
      </div>
      <button className="timer-dismiss" onClick={onDone}>Skip</button>
    </div>
  );
}

// ─── Video ────────────────────────────────────────────────────────────────────
// Exercise demo clips are not part of this repo. Point VITE_VIDEO_BASE at your own folder or CDN.
// If a clip is missing, the player hides itself.
const VIDEO_BASE = import.meta.env.VITE_VIDEO_BASE || "/videos";

const VideoVisual = ({ vid, color }) => {
  if (!vid) return null;
  return (
    <div style={{ borderRadius: '14px', margin: '16px', overflow: 'hidden', position: 'relative',
      paddingBottom: '56.25%', border: `1px solid ${color}33`, background: '#000',
      boxShadow: `0 8px 30px rgba(0,0,0,0.4)` }}>
      <video style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
        src={`${VIDEO_BASE}/${vid}.mp4`} autoPlay loop muted playsInline onError={(e) => { e.currentTarget.style.display = "none"; }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', boxShadow: `inset 0 0 20px rgba(0,0,0,0.8)` }} />
    </div>
  );
};

// ─── Plate Calculator ─────────────────────────────────────────────────────────
const PLATE_COLORS = { 20: '#E53E3E', 15: '#3B82F6', 10: '#FBBF24', 5: '#10B981', 2.5: 'var(--text-secondary)', 1.25: '#718096' };

function PlateCalculator() {
  const [target, setTarget] = useState("");
  const [barKg, setBarKg] = useState(20);
  const val = parseFloat(target) || 0;
  const plates = val > 0 ? calcPlates(val, barKg) : [];
  const totalLoaded = barKg + plates.reduce((s, p) => s + p.kg * p.count * 2, 0);

  return (
    <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 className="heading" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Plate Calculator</h2>
        <span style={{ background: '#F59E0B22', color: '#F59E0B', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700 }}>⚖️ Load</span>
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
        Enter your target weight. See exactly which plates to put on each side of the bar.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[20, 15, 10].map(b => (
          <button key={b} onClick={() => setBarKg(b)} style={{
            flex: 1, padding: '10px', borderRadius: 12,
            border: `1px solid ${barKg === b ? '#F59E0B' : 'rgba(255,255,255,0.08)'}`,
            background: barKg === b ? 'rgba(245,158,11,0.15)' : 'rgba(0,0,0,0.3)',
            color: barKg === b ? '#F59E0B' : '#718096',
            fontFamily: 'Outfit', fontWeight: 700, fontSize: 13, cursor: 'pointer'
          }}>{b}kg bar</button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <input className="plate-input" type="text" inputMode="decimal" autoComplete="off"
          placeholder="e.g. 80" value={target} onChange={e => setTarget(e.target.value)} />
        <span style={{ fontSize: 18, color: '#718096', fontFamily: 'Outfit', fontWeight: 700 }}>kg</span>
      </div>

      {val > 0 && (
        <div style={{ background: 'rgba(20,20,25,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 20 }}>
          {plates.length === 0 ? (
            <div style={{ color: '#718096', fontSize: 14, textAlign: 'center' }}>
              {val <= barKg ? `Just the ${barKg}kg bar — no plates needed.` : 'Cannot load exactly with standard plates.'}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#718096', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 14 }}>Each side of the bar</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                {plates.map(({ kg, count }) =>
                  Array.from({ length: count }, (_, i) => (
                    <div key={`${kg}-${i}`} className="plate-chip"
                      style={{ background: `${PLATE_COLORS[kg]}22`, color: PLATE_COLORS[kg], border: `1px solid ${PLATE_COLORS[kg]}44` }}>
                      {kg}kg
                    </div>
                  ))
                )}
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#718096', fontWeight: 600 }}>TOTAL ON BAR</div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Outfit', color: 'var(--text-primary)' }}>{totalLoaded}kg</div>
                </div>
                {totalLoaded !== val && (
                  <div style={{ fontSize: 12, color: '#F59E0B', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '8px 12px', textAlign: 'right' }}>
                    Closest: {totalLoaded}kg<br/>
                    <span style={{ color: '#718096' }}>Target: {val}kg</span>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#718096' }}>
                Bar: {barKg}kg · Each side: {plates.map(p => `${p.count}×${p.kg}`).join(' + ')}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Session History ──────────────────────────────────────────────────────────
function SessionHistory({ log }) {
  const dayColors = { Monday: '#FF4B4B', Wednesday: '#3B82F6', Friday: '#8B5CF6' };
  const sessions = [];

  for (const key of Object.keys(log).sort().reverse()) {
    const match = key.match(/^(Monday|Wednesday|Friday)-(\d{4}-\d{2}-\d{2})$/);
    if (!match) continue;
    const [, dayName, date] = match;
    const dayData = days.find(d => d.day === dayName);
    if (!dayData) continue;
    const sessionData = log[key];

    const exercises = dayData.exercises.map((ex, i) => {
      const k = `${dayName}-${i}`;
      const sets = sessionData[k] || {};
      const loggedSets = Object.entries(sets)
        .filter(([, v]) => v?.kg || v?.reps)
        .map(([si, v]) => ({ si: parseInt(si), kg: v.kg, reps: v.reps }))
        .sort((a, b) => a.si - b.si);
      return { name: ex.name, sets: loggedSets };
    }).filter(e => e.sets.length > 0);

    if (exercises.length > 0) {
      sessions.push({ dayName, date, color: dayColors[dayName], exercises });
    }
  }

  if (sessions.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#4A5568' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
        <div style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 16, color: '#718096' }}>No sessions logged yet</div>
        <div style={{ fontSize: 13, marginTop: 8 }}>Log weights on your workout tabs — history appears here.</div>
      </div>
    );
  }

  return (
    <div>
      {sessions.map(({ dayName, date, color, exercises }) => {
        const d = new Date(date + 'T12:00:00');
        const label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
        return (
          <div key={`${dayName}-${date}`} className="hist-day-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color, textTransform: 'uppercase' }}>{dayName}</span>
                <div style={{ fontSize: 13, color: '#718096', marginTop: 2 }}>{label}</div>
              </div>
              <span style={{ fontSize: 11, background: `${color}22`, color, border: `1px solid ${color}44`, borderRadius: 6, padding: '4px 10px', fontWeight: 700 }}>
                {exercises.length} logged
              </span>
            </div>
            {exercises.map((ex, ei) => (
              <div key={ei} className="hist-ex-row">
                <div style={{ fontWeight: 600, color: '#E2E8F0', marginBottom: 6 }}>{ex.name}</div>
                <div>
                  {ex.sets.map((s, si) => (
                    <span key={si} className="hist-set-pill">
                      S{s.si + 1}{s.kg ? ` ${s.kg}kg` : ''}{s.reps ? ` × ${s.reps}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Exercise data ────────────────────────────────────────────────────────────
const days = [
  {
    day: "Monday", type: "PUSH", muscles: "Chest · Shoulders · Triceps", color: "#FF4B4B", duration: "~60-65 min",
    exercises: [
      { name: "Nautilus Chest Press", vid: "Qu7-ceCvq7w", sets: 4, reps: "12-15", kg: "30-40 kg", rest: 90,
        focus: "Feel your CHEST pushing — keep shoulders depressed and back against the pad",
        how: "Adjust seat so handles are mid-chest. Depress your scapula (pull shoulders down and back). Press forward in a smooth motion, stopping just before elbow lockout to keep tension on the pecs. Slowly control the eccentric (lowering) phase for 3 seconds.",
        note: "Start light. Full range. Don't lock elbows.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Nautilus Shoulder Press", vid: "6v4nrRVySj0", sets: 3, reps: "12-15", kg: "20-30 kg", rest: 90,
        focus: "Press straight up, keeping elbows slightly tucked — don't flare them 90 degrees",
        how: "Sit tall with core braced. Grab handles and press the weight up towards the ceiling. Keep your elbows slightly in front of your body (scapular plane) to protect the shoulder joint. Lower slowly until hands are ear-level.",
        note: "Back flat against pad. Don't shrug.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Cable Crossover Fly", vid: "I-Ue34qLxc4", sets: 3, reps: "15", kg: "7.5-10 kg", rest: 60,
        focus: "Imagine hugging a large tree — constant tension on the chest",
        how: "Set pulleys above shoulder height. Take a staggered stance for stability. Keeping a slight bend in your elbows, bring your hands together in a wide arc. Flex your pecs hard when your hands meet. Resist the weight as your arms open back up.",
        note: "Pulleys HIGH above shoulders. Slow movement.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Cable Tricep Pushdown (Rope)", vid: "1FjkhpZsaxc", sets: 3, reps: "15", kg: "10-15 kg", rest: 60,
        focus: "Elbows act as hinges — absolutely zero shoulder movement",
        how: "Attach a rope to the high pulley. Keep your chest up and pin your elbows tightly to your ribcage. Push the rope down, spreading the ends apart at the bottom to fully contract the triceps. Squeeze for 1 second, then control the weight back up.",
        note: "Elbows fixed. Squeeze at bottom.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Dumbbell Lateral Raises", vid: "xyK8UiC-BUw", sets: 3, reps: "15-20", kg: "5-8 kg", rest: 60,
        focus: "Pour the water — slight inward turn of the wrists at the top",
        how: "Hold dumbbells with a slight forward lean. Lead with your elbows and raise the weights to the sides until parallel with the floor. At the top, slightly tilt the dumbbells as if pouring water from a pitcher to isolate the medial deltoid. Lower slowly.",
        note: "Raise to shoulder height only. No swinging.", prog: "Double progression: add weight when 20 reps is reached" },
      { name: "Push-Up", vid: "_YrJc-kTYA0", sets: 2, reps: "10-12", kg: "Body", rest: 60,
        focus: "Body straight as a board — core engaged, glutes squeezed",
        how: "Place hands slightly wider than shoulders. Lower your chest until it nearly touches the floor, keeping elbows tucked at a 45-degree angle. Push explosively back to the top. If your form breaks down, switch to incline push-ups.",
        note: "Use incline push-ups if floor is too hard.", prog: "Work toward 3 sets by week 4" },
    ]
  },
  {
    day: "Wednesday", type: "PULL", muscles: "Back · Biceps · Rear Delts", color: "#3B82F6", duration: "~60-65 min",
    exercises: [
      { name: "Nautilus Lat Pulldown", vid: "bNmvKpJSWKM", sets: 4, reps: "12-15", kg: "35-45 kg", rest: 90,
        focus: "Initiate with your back — pull shoulder blades down before bending elbows",
        how: "Lock your knees under the pad. Grab the wide bar and lean back slightly (15 degrees). Pull your shoulder blades down first, then drive your elbows toward your hips. Squeeze your lats at the bottom, then let the bar stretch your back on the way up.",
        note: "Don't swing. Pull to upper chest.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Cable Seated Row", vid: "8QuMq1GMMng", sets: 3, reps: "12-15", kg: "25-35 kg", rest: 90,
        focus: "Squeeze a pencil between your shoulder blades at the peak of the pull",
        how: "Sit with knees slightly bent. Let the weight pull your shoulders forward slightly for a deep stretch, then pull the handle to your lower ribs while keeping your chest tall. Squeeze your mid-back aggressively before slowly returning the weight.",
        note: "Sit tall. Don't hunch forward.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Assisted Pull-Up", vid: "OEXosPwzFdc", sets: 3, reps: "5-8", kg: "Band", rest: 90,
        focus: "Full dead hang at the bottom — no half reps",
        how: "Use a resistance band for support. Start from a dead hang with arms fully extended. Drive your elbows down to pull your chin over the bar. Control your descent back to a complete dead hang. This builds real pulling power.",
        note: "Use lighter band every month. Done while back is fresh.", prog: "Goal: 1 unassisted pull-up by week 8" },
      { name: "Cable Face Pull", vid: "IeOqdw9WI90", sets: 3, reps: "15", kg: "10-15 kg", rest: 60,
        focus: "Pull to the forehead and rotate hands back to hit the rear delts",
        how: "Set the pulley at upper chest height with a rope. Pull the rope towards your eyes, simultaneously pulling the ends apart and rotating your knuckles back (external rotation). This is crucial for fixing posture and shoulder health.",
        note: "Rope attachment. Face height. Hold 1 sec.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Dumbbell Bicep Curl", vid: "PuaJzTatIJM", sets: 3, reps: "12", kg: "12-16 kg", rest: 60,
        focus: "Supinate (turn palms up) as you curl to fully activate the bicep",
        how: "Start with dumbbells at your sides, palms facing in. As you curl up, twist your wrists so palms face your shoulders at the top. Squeeze the biceps hard, then lower slowly over 3 seconds. Keep elbows locked at your sides.",
        note: "Elbows nailed to sides. Full range.", prog: "Double progression: add weight when 12 reps is reached" },
      { name: "Cable Hammer Curl (Rope)", vid: "YC9QZiti-40", sets: 3, reps: "12", kg: "10-15 kg", rest: 60,
        focus: "Thumbs up the entire time to build the brachialis",
        how: "Use a low pulley with a rope. Keep a neutral grip (palms facing each other) and curl the rope straight up. This targets the brachialis muscle underneath the bicep, pushing it up to make your arms look thicker.",
        note: "Neutral grip. Rope attachment.", prog: "Double progression: add weight when 12 reps is reached" },
    ]
  },
  {
    day: "Friday", type: "LEGS", muscles: "Quads · Hamstrings · Glutes · Calves", color: "#8B5CF6", duration: "~65-70 min",
    exercises: [
      { name: "Leg Press", vid: "nDh_BlnLCGc", sets: 4, reps: "10-15", kg: "60-80 kg", rest: 90,
        focus: "Drive through the mid-foot and heels — never let your lower back round",
        how: "Place feet shoulder-width on the platform. Lower the weight under control until your knees are at 90 degrees. If your butt lifts off the seat, you went too low. Press the weight back up powerfully without locking your knees out.",
        note: "Don't lock knees. Deep range.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Leg Extension", vid: "iQ92TuvBqRo", sets: 3, reps: "12-15", kg: "20-30 kg", rest: 60,
        focus: "The magic is in the squeeze at the top and the slow descent",
        how: "Sit back firmly against the pad. Extend your legs fully and squeeze your quads intensely for 1 full second at the top. Fight the weight on the way down for 3 seconds. This isolates the quad muscles perfectly.",
        note: "Slow lowering is where quads really work.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Dumbbell Romanian Deadlift", vid: "lRYBbchqxtI", sets: 3, reps: "10-12", kg: "16-24 kg", rest: 90,
        focus: "Hinge at the hips — imagine pushing a car door closed with your glutes",
        how: "Hold dumbbells close to your thighs. Keep your shins totally vertical and a slight, fixed bend in your knees. Push your hips straight back until you feel a massive stretch in your hamstrings. Squeeze glutes to stand back up.",
        note: "Keep back flat. Feel the hamstring stretch.", prog: "Double progression: add weight when 12 reps is reached" },
      { name: "Seated Leg Curl", vid: "_lgE0gPvbik", sets: 3, reps: "12-15", kg: "20-30 kg", rest: 60,
        focus: "Lock your hips into the pad — don't use momentum to swing the weight",
        how: "Adjust the machine so the pad sits exactly behind your ankles. Curl the weight down aggressively, hold the contraction for 1 second, and resist the eccentric for 3 seconds. This completes the hamstring isolation.",
        note: "Hold 1 sec at peak.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Goblet Squat", vid: "Pz-mEGJKwWQ", sets: 3, reps: "10-15", kg: "10-16 kg", rest: 90,
        focus: "Sit deep between your knees to maximize quad burn and hip mobility",
        how: "Hold a dumbbell vertically against your chest. Keep your torso completely upright and sit down deep, pushing your knees out. This is a lighter finishing movement to pump blood into the quads and glutes.",
        note: "Heels flat. Deep squat. Chest up.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Standing Calf Raise", vid: "SVtg-1loH4c", sets: 3, reps: "15-20", kg: "Body", rest: 60,
        focus: "Pause for a full second in the deep stretch at the bottom",
        how: "Stand on an edge with your heels hanging off. Drop your heels as low as they can go and hold the stretch for 1 second. Explosively push up onto your big toes and squeeze the calves hard. No bouncing allowed.",
        note: "Use the leg press machine for this — toes on platform edge.", prog: "Add weight by holding dumbbell once bodyweight becomes easy" },
      { name: "Ab Crunch Machine", vid: "3zJxX6PvwCc", sets: 3, reps: "15", kg: "15-25 kg", rest: 60,
        focus: "Curl your spine like a C-shape — don't just fold at the hips",
        how: "Lock yourself into the machine. Instead of keeping a flat back, physically crunch your abs together, bringing your sternum toward your pelvis. Exhale forcefully as you contract.",
        note: "No momentum.", prog: "Double progression: add weight when 15 reps is reached" },
      { name: "Battle Rope", vid: "Bmdhgscsk-Y", sets: 4, reps: "20s", kg: "Body", rest: 40,
        focus: "Maximum intensity — leave nothing in the tank for 20 seconds",
        how: "Optional finisher. Grab one end rope each hand. Feet shoulder width, knees slightly bent. Alternate slamming each arm up and down as fast and hard as possible — creating waves. Go all out for 20 seconds. Rest 40 seconds. Repeat 4 times.",
        note: "20s work / 40s rest.", prog: "Reduce rest by 5s every 2 weeks" },
    ]
  }
];

const warmup = [
  { name: "Treadmill Incline Walk", vid: "vdsaHSr1H_E", detail: "Incline 10-12 | Speed 3 | 5-8 min", how: "Step on treadmill, set incline 10-12 and speed 3. Walk like climbing a hill. Hold handles lightly — don't lean. Gets blood flowing and warms your whole body before touching a single weight." },
  { name: "Arm Circles + Shoulder Rolls", vid: "ndmSvkEdNQQ", detail: "30 sec each direction", how: "Arms out to sides. Small circles forward 15 sec, backward 15 sec. Then roll shoulders forward 5 times, backward 5 times. Do this BEFORE the machines — gets joints moving while muscles are still cold." },
  { name: "Cable Face Pull (Light)", vid: "IeOqdw9WI90", detail: "5 kg | 15 reps", how: "For Upper Body days. Pulley at face height. Rope attachment. Pull toward face splitting hands apart — like touching both ears. Hold 1 second. Protects your shoulders." },
  { name: "Cable Lat Pulldown (Light)", vid: "bNmvKpJSWKM", detail: "10 kg | 15 reps", how: "For Pull day. Sit at lat machine, grab wide bar. Pull down to upper chest leaning back slightly. Slowly back up. Opens your back and shoulders." },
];

const cooldown = [
  { name: "Chest Stretch (Cable)", vid: "I-Ue34qLxc4", detail: "30 sec each side", how: "One pulley at shoulder height. Grab handle one hand. Turn body away from machine until you feel stretch across chest. Hold 30 sec. Switch sides." },
  { name: "Hip Flexor Stretch", vid: "DXuStgWuJV8", detail: "Kneeling | 30 sec each side", how: "Kneel on one knee. Other foot in front, knee bent 90 degrees. Push hips gently forward until stretch in front of back hip. Critical — you sit all day, your hip flexors are tight." },
  { name: "Hamstring Stretch", vid: "iG7Z4F14ijs", detail: "Seated | 30 sec", how: "Sit on floor, legs straight. Reach hands toward feet as far as possible without bending knees. Hold where it feels tight. Don't bounce. Breathe slowly." },
  { name: "Shoulder Cross-Body", vid: "-1K0m5ywRcY", detail: "30 sec each side", how: "Bring one arm across chest. Use other hand to press it closer to body until stretch in back of shoulder. Hold. Switch. Do after every session." },
  { name: "Child's Pose", vid: "2MJGg-dUKh0", detail: "30-60 sec", how: "Kneel, sit back on heels, reach arms forward on floor, drop head down. Whole back stretches. Hold and breathe deeply. This tells your body the session is done." },
];

const progression = [
  { weeks: "Weeks 1-2", weekNums: [1,2], pct: "60%", focus: "Learn the movements. Light weight. Perfect form.", detail: "Don't be a hero. Your body is relearning. Focus on feeling each muscle work. You will be sore — that's completely normal." },
  { weeks: "Weeks 3-4", weekNums: [3,4], pct: "65%", focus: "Double progression. Add reps, then weight.", detail: "Your nervous system has adapted. Work up to the top of your rep range. Once you hit it with good form and 1-2 reps in reserve, increase the weight slightly next time." },
  { weeks: "Weeks 5-6", weekNums: [5,6], pct: "70%", focus: "Push harder. Sweat properly. Body changing.", detail: "By now the gym feels normal. Push the weights up using double progression. Body composition starts changing — people might notice before you do." },
  { weeks: "Weeks 7-8", weekNums: [7,8], pct: "75%", focus: "Strength gains visible. First pull-up goal.", detail: "This is the turning point. Try your first unassisted pull-up. Even if you can't, the attempt shows how far you've come." },
  { weeks: "Weeks 9-10", weekNums: [9,10], pct: "80%", focus: "Body clearly changing. Stay hungry.", detail: "You look different. You feel different. Don't get comfortable — this is when people slack off. Stay consistent." },
  { weeks: "Weeks 11-12", weekNums: [11,12], pct: "85%", focus: "Full intensity. Finish strong. Plan next.", detail: "Finish strong. At the end of week 12, take stock. How much stronger? Then we plan the next block together." },
];

const tabs = ["Monday", "Wednesday", "Friday", "Warm-Up", "Suplesse", "Progress", "History", "Plates"];

// ─── Set Log Row ──────────────────────────────────────────────────────────────
function SetLogRow({ setNum, color, value, lastValue, onChange, onSetDone, isDone, onTimer, restSecs }) {
  return (
    <div className="set-log-row">
      <span className="set-label">S{setNum}</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <input className="log-input" type="text" inputMode="decimal" autoComplete="off"
          placeholder={lastValue?.kg ? `${lastValue.kg}` : "kg"}
          value={value?.kg ?? ""} onChange={e => onChange({ ...value, kg: e.target.value })}
          style={{ '--active-color': color }} />
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4 }}>
          <span className="log-input-label">KG</span>
          {value?.kg && !isNaN(value.kg) && (
            <span className="log-input-label" style={{ opacity: 0.65 }}>≈ {(parseFloat(value.kg) * 2.20462).toFixed(1)} lbs</span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <input className="log-input" type="text" inputMode="numeric" autoComplete="off"
          placeholder={lastValue?.reps ? `${lastValue.reps}` : "reps"}
          value={value?.reps ?? ""} onChange={e => onChange({ ...value, reps: e.target.value })}
          style={{ '--active-color': color }} />
        <span className="log-input-label">REPS</span>
      </div>
      <button className={`set-done-btn ${isDone ? 'set-done' : ''}`} style={{ '--active-color': color }}
        onClick={() => { onSetDone(); if (!isDone) onTimer(restSecs); }}>
        {isDone
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#718096" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        }
      </button>
    </div>
  );
}

// ─── Exercise Card ────────────────────────────────────────────────────────────
function ExCard({ ex, i, color, prefix, day, onTimer, log, setLog }) {
  const k = `${prefix}-${i}`;
  const sessionKey = day ? todayKey(day) : null;
  const lastKey    = day ? lastSessionKey(day, log) : null;
  const todaySets  = sessionKey ? (log[sessionKey]?.[k] || {}) : {};
  const lastSets   = lastKey    ? (log[lastKey]?.[k]    || {}) : {};
  const done       = sessionKey ? !!log[sessionKey]?.[`${k}-done`] : false;
  const [open, setOpen] = useState(false);
  const numSets = typeof ex.sets === 'number' ? ex.sets : 0;
  const hasLastSession = lastKey && Object.values(lastSets).some(v => v?.kg || v?.reps);

  function updateSet(si, val) {
    setLog(prev => {
      const next = { ...prev };
      if (!next[sessionKey]) next[sessionKey] = {};
      if (!next[sessionKey][k]) next[sessionKey][k] = {};
      next[sessionKey][k][si] = val;
      saveLog(next); return next;
    });
  }
  function toggleSetDone(si) {
    setLog(prev => {
      const next = { ...prev };
      if (!next[sessionKey]) next[sessionKey] = {};
      next[sessionKey][`${k}-s${si}`] = !next[sessionKey][`${k}-s${si}`];
      saveLog(next); return next;
    });
  }
  function toggleDone() {
    if (!sessionKey) return;
    setLog(prev => {
      const next = { ...prev };
      if (!next[sessionKey]) next[sessionKey] = {};
      next[sessionKey][`${k}-done`] = !next[sessionKey][`${k}-done`];
      saveLog(next); return next;
    });
  }

  return (
    <div className={`ex-card ${done ? 'done' : ''}`} style={{ '--active-color': color, '--active-color-dim': color + '44' }}>
      <div onClick={toggleDone} style={{ padding: '20px 18px', cursor: 'pointer', display: 'flex', gap: '16px' }}>
        <div className="check-circle">
          {done && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '17px', color: done ? '#718096' : 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none', letterSpacing: '-0.3px' }}>{ex.name}</h3>
          {ex.sets ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <div className="badge" style={{ color }}><span style={{ color: '#718096', fontWeight: 500 }}>Sets</span> {ex.sets}</div>
              <div className="badge" style={{ color }}><span style={{ color: '#718096', fontWeight: 500 }}>Reps</span> {ex.reps}</div>
              <div className="badge" style={{ color: 'var(--text-secondary)' }}><span style={{ color: '#718096', fontWeight: 500 }}>Rest</span> {ex.rest}s</div>
              <div className="badge" style={{ color: '#E2E8F0' }}><span style={{ color: '#718096', fontWeight: 500 }}>Weight</span> {ex.kg}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '12px' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{ex.detail}</div>
              {ex.detail && ex.detail.includes("sec") && (
                <button 
                  onClick={(e) => { e.stopPropagation(); onTimer(ex.detail.includes("60") ? 60 : 30); }}
                  style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 11, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Timer
                </button>
              )}
            </div>
          )}
          {ex.focus && (
            <div style={{ fontSize: '13px', color, display: 'flex', alignItems: 'flex-start', gap: '8px', background: `${color}11`, padding: '8px 12px', borderRadius: '8px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span style={{ lineHeight: '1.4' }}>{ex.focus}</span>
            </div>
          )}
        </div>
      </div>

      {numSets > 0 && sessionKey && (
        <div onClick={e => e.stopPropagation()} style={{ padding: '0 18px 16px' }}>
          {hasLastSession && (
            <div style={{ fontSize: 11, color: '#4A5568', marginBottom: 8, fontFamily: 'Outfit', fontWeight: 600, letterSpacing: '0.5px' }}>
              LAST SESSION ↑ shown as placeholders
            </div>
          )}
          {Array.from({ length: numSets }, (_, si) => (
            <SetLogRow key={si} setNum={si + 1} color={color}
              value={todaySets[si]} lastValue={lastSets[si]}
              onChange={val => updateSet(si, val)}
              isDone={!!log[sessionKey]?.[`${k}-s${si}`]}
              onSetDone={() => toggleSetDone(si)}
              onTimer={onTimer} restSecs={ex.rest || 60} />
          ))}
        </div>
      )}

      <div onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: open ? 'rgba(0,0,0,0.2)' : 'transparent' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3"/></svg>
          {open ? 'Hide details' : 'How to do it + Video'}
        </span>
        <svg style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>

      <div className={`expand-content ${open ? 'open' : ''}`}>
        <div className="expand-inner">
          <VideoVisual vid={ex.vid} color={color} />
          <div style={{ padding: '0 18px 20px' }}>
            <p style={{ margin: '0 0 18px', fontSize: '14px', lineHeight: '1.7', color: '#CBD5E0' }}>{ex.how}</p>
            {ex.note && (
              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '10px', padding: '14px', marginBottom: '14px', borderLeft: `3px solid ${color}` }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#718096', marginBottom: '6px', fontWeight: 700 }}>Coach Note</div>
                <div style={{ fontSize: '13px', color: '#E2E8F0', lineHeight: '1.5' }}>{ex.note}</div>
              </div>
            )}
            {ex.prog && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#48BB78', background: 'rgba(72, 187, 120, 0.1)', padding: '10px 14px', borderRadius: '8px', fontWeight: 500 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                {ex.prog}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("yaz-theme") || "dark");
  const [tab, setTab] = useState("Monday");
  const [timer, setTimer] = useState(null);
  const [log, setLog] = useState(() => loadLog());
  const [currentWeek, setCurrentWeek] = useState(() => loadWeek());
  
  // Firebase Auth State
  const [user, setUser] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("yaz-theme", theme);
  }, [theme]);

  // Firebase Auth Listener
  useEffect(() => {
    if (!auth) return undefined;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Fetch cloud data and merge
        setIsSyncing(true);
        const cloudLog = await fetchLogFromCloud(currentUser.uid);
        if (cloudLog) {
          setLog(prev => {
            const merged = { ...prev, ...cloudLog };
            saveLog(merged);
            return merged;
          });
        }
        setIsSyncing(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Debounced Cloud Sync
  useEffect(() => {
    if (user && Object.keys(log).length > 0) {
      const timeoutId = setTimeout(async () => {
        setIsSyncing(true);
        await syncLogToCloud(user.uid, log);
        setIsSyncing(false);
      }, 2000);
      return () => clearTimeout(timeoutId);
    }
  }, [log, user]);

  function setWeek(w) {
    const clamped = Math.min(12, Math.max(1, w));
    setCurrentWeek(clamped);
    saveWeek(clamped);
  }

  const activeDay = days.find(d => d.day === tab);
  const currentPhase = progression.find(p => p.weekNums.includes(currentWeek));

  const getTabColor = (t) => {
    if (t === "Warm-Up") return "#F59E0B";
    if (t === "Suplesse") return "#10B981";
    if (t === "Progress") return "#EC4899";
    if (t === "History") return "#06B6D4";
    if (t === "Plates") return "#F59E0B";
    const d = days.find(x => x.day === t);
    return d ? d.color : "var(--text-primary)";
  };

  return (
    <div className="app-container">
      <GlobalStyles />

      <div className="glass-header">
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          {/* Week tracker */}
          <div className="week-bar">
            <button className="week-stepper" onClick={() => setWeek(currentWeek - 1)}>−</button>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: '#718096', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
                  <span>Week {currentWeek} of 12</span>
                  {user && (
                    <span style={{ position: 'absolute', right: 0, color: isSyncing ? '#EAB308' : '#22C55E', textTransform: 'none', letterSpacing: 'normal' }}>
                      {isSyncing ? "Syncing..." : "Synced ✅"}
                    </span>
                  )}
                </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(currentWeek / 12) * 100}%`, background: '#EC4899', borderRadius: 4, transition: 'width 0.3s ease', boxShadow: '0 0 8px #EC489966' }} />
              </div>
              {currentPhase && (
                <div style={{ fontSize: 11, color: '#EC4899', marginTop: 3, fontWeight: 600 }}>{currentPhase.pct} intensity · {currentPhase.focus.split('.')[0]}</div>
              )}
            </div>
            <button className="week-stepper" onClick={() => setWeek(currentWeek + 1)}>+</button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h1 className="heading gradient-text" style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: '-0.5px' }}>
              Yaz's PPL Program 💪
            </h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <img src={user.photoURL} alt="avatar" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                  <button onClick={logout} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Sign Out</button>
                </div>
              ) : (
                cloudEnabled && <button onClick={loginWithGoogle} style={{ background: 'var(--color-pull)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)' }}>
                  Cloud Sync
                </button>
              )}
              <button onClick={generateCalendarICS} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }} aria-label="Add to Calendar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                <span className="hide-mobile">Add to Calendar</span>
              </button>
              <ThemeToggle theme={theme} setTheme={setTheme} />
            </div>
          </div>

          <div className="tabs-container">
            {tabs.map(t => {
              const active = tab === t;
              const color = getTabColor(t);
              return (
                <button key={t} onClick={() => setTab(t)} className={`tab-btn ${active ? 'active' : ''}`} style={{ '--active-color': color }}>
                  {t === "Monday" ? "MON Push" : t === "Wednesday" ? "WED Pull" : t === "Friday" ? "FRI Legs" :
                   t === "Warm-Up" ? "🔥 Warm" : t === "Suplesse" ? "🧘 Suplesse" : t === "Progress" ? "📈 Plan" :
                   t === "History" ? "📋 History" : "⚖️ Plates"}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="content-area">
        {activeDay && (
          <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <span style={{ display: "inline-block", background: `${activeDay.color}22`, border: `1px solid ${activeDay.color}44`, borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 800, letterSpacing: 2, color: activeDay.color, textTransform: "uppercase", marginBottom: 8 }}>{activeDay.type} DAY</span>
                <div style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 500 }}>{activeDay.muscles}</div>
              </div>
              <div style={{ fontSize: 12, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "8px 14px", textAlign: "right" }}>
                <div style={{ color: "#718096", marginBottom: 2, fontWeight: 500 }}>Total time</div>
                <div style={{ fontWeight: 700, color: "#E2E8F0" }}>{activeDay.duration}</div>
              </div>
            </div>
            <div style={{ background: "rgba(20,20,25,0.4)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 12, padding: "12px 16px", marginBottom: 24, fontSize: 12, color: "var(--text-secondary)", display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '18px' }}>💡</span>
              <span style={{ lineHeight: '1.5' }}>Log your weight + reps for each set. Tap ✓ when a set is done — rest timer starts automatically.</span>
            </div>
            {activeDay.exercises.map((ex, i) => (
              <ExCard key={i} ex={ex} i={i} color={activeDay.color} prefix={tab} day={activeDay.day}
                onTimer={(secs) => setTimer({ seconds: secs, color: activeDay.color, id: Date.now() })}
                log={log} setLog={setLog} />
            ))}
            <button
              onClick={() => {
                confetti({
                  particleCount: 150,
                  spread: 70,
                  origin: { y: 0.6 },
                  colors: [activeDay.color, '#fff', '#FFD700']
                });
              }}
              style={{
                width: '100%', padding: '16px', marginTop: 16, borderRadius: 12,
                background: activeDay.color, color: '#fff', fontSize: 16, fontWeight: 700,
                border: 'none', cursor: 'pointer', boxShadow: `0 4px 14px ${activeDay.color}66`
              }}
            >
              🎉 Finish Workout
            </button>
          </div>
        )}

        {tab === "Warm-Up" && (
          <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 className="heading" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>Warm-Up Routine</h2>
              <span style={{ background: "#F59E0B22", color: "#F59E0B", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>10-12 min</span>
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24, lineHeight: '1.6' }}>Do this before every session. It prepares your joints, gets blood flowing, and tells your nervous system it's time to work.</p>
            {warmup.map((s, i) => (
              <ExCard key={i} ex={s} i={i} color="#F59E0B" prefix="wu" log={log} setLog={setLog} 
                onTimer={(secs) => setTimer({ seconds: secs, color: "#F59E0B", id: Date.now() })} />
            ))}
          </div>
        )}

        {tab === "Suplesse" && (
          <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 className="heading" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>Cool-Down / Suplesse</h2>
              <span style={{ background: "#10B98122", color: "#10B981", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>8-10 min</span>
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24, lineHeight: '1.6' }}>Do this after every session. No skipping. This is your suplesse — keeps you moving smooth, prevents tightness, and jumpstarts recovery.</p>
            {cooldown.map((s, i) => <ExCard key={i} ex={s} i={i} color="#10B981" prefix="cd" log={log} setLog={setLog} />)}
          </div>
        )}

        {tab === "Progress" && (
          <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
            <h2 className="heading" style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>12-Week Roadmap</h2>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24, lineHeight: '1.6' }}>Each phase builds on the last. Trust the process, eat enough protein, and prioritize sleep.</p>
            {progression.map((p, i) => {
              const isCurrent = p.weekNums.includes(currentWeek);
              return (
                <div key={i} className={`progress-card ${isCurrent ? 'current-week' : ''}`}>
                  <div className="pct-box" style={{ background: isCurrent ? 'rgba(236,72,153,0.2)' : 'rgba(236,72,153,0.1)', color: '#EC4899', border: `1px solid ${isCurrent ? 'rgba(236,72,153,0.5)' : 'rgba(236,72,153,0.2)'}` }}>
                    {p.pct}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#718096", letterSpacing: '1px', textTransform: 'uppercase' }}>{p.weeks}</div>
                      {isCurrent && <span style={{ fontSize: 10, fontWeight: 800, background: '#EC4899', color: '#fff', borderRadius: 4, padding: '2px 6px', letterSpacing: 1 }}>YOU ARE HERE</span>}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{p.focus}</div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{p.detail}</div>
                  </div>
                </div>
              );
            })}
            <div style={{ background: "rgba(16, 185, 129, 0.05)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: 16, padding: 24, marginTop: 32 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#10B981", marginBottom: 16, textTransform: 'uppercase', letterSpacing: '1px' }}>🎯 Phase 1 Goals</div>
              {["Consistency: Show up every Monday, Wednesday, Friday", "1 unassisted pull-up by Week 8", "Visible physical change by Week 6", "Build a solid foundation of strength", "Feel strong and confident in your own skin"].map((g, i) => (
                <div key={i} style={{ fontSize: 13, color: "#E2E8F0", padding: "10px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none", display: "flex", gap: 12, alignItems: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span style={{ lineHeight: '1.5' }}>{g}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "History" && (
          <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 className="heading" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>Session History</h2>
              <span style={{ background: "#06B6D422", color: "#06B6D4", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>📋 Log</span>
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24, lineHeight: '1.6' }}>Every set you've logged, newest first. Your progress is real.</p>
              <Suspense fallback={<div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>Loading Chart...</div>}>
                <HistoryChart log={log} days={days} />
              </Suspense>
            <div style={{ marginTop: 32 }}>
              <SessionHistory log={log} />
            </div>
          </div>
        )}

        {tab === "Plates" && (
          <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
            <PlateCalculator />
          </div>
        )}

        <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12, color: "#718096", textAlign: "center", fontFamily: "'Outfit', sans-serif", fontWeight: 500, letterSpacing: '1px' }}>
          BUILT FOR YAZ · PUSH PULL LEGS · START MONDAY
        </div>
      </div>

      {timer && (
        <RestTimer key={timer.id} seconds={timer.seconds} color={timer.color} onDone={() => setTimer(null)} />
      )}
    </div>
  );
}
