import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import webpush from "web-push";

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = process.env.ROTINA_DATA_DIR ? path.resolve(process.env.ROTINA_DATA_DIR) : path.join(__dirname, "data");
const dbFile = path.join(dataDir, "rotina.json");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const appUrl = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, "");
const secureCookies = appUrl.startsWith("https://");

const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleConfigured = Boolean(googleClientId && googleClientSecret);
const allowedEmail = (process.env.ALLOWED_EMAIL || "").trim().toLowerCase();
const loginPassword = process.env.ROTINA_PASSWORD || "";

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
];

const SESSION_COOKIE = "rotina_sid";
const SESSION_DAYS = 60;
const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const POST_STAGES = ["ideia", "roteiro", "gravacao", "edicao", "agendado", "postado"];
const POST_FORMATS = ["reels", "carrossel", "stories", "post", "live"];

const defaultDb = () => ({
  version: 1,
  settings: {
    timezone: "America/Sao_Paulo",
    calendarId: "primary",
    defaultReminder: 10,
    morningTime: "07:30",
    reviewTime: "21:30",
    notifyCalendarEvents: true,
    gcalReminders: false,
  },
  areas: [
    { id: "sdr", name: "SDR", color: "#2563eb", gcalColorId: "9" },
    { id: "conteudo", name: "Instagram", color: "#db2777", gcalColorId: "4" },
    { id: "pessoal", name: "Pessoal", color: "#d97706", gcalColorId: "6" },
  ],
  routines: [],
  tasks: [],
  habits: [],
  posts: [],
  completions: {},
  checkins: {},
  reviews: {},
  push: { vapid: null, subscriptions: [] },
  google: { email: "", name: "", picture: "", refreshToken: "", accessToken: "", expiresAt: 0, error: "" },
  sessions: {},
  sent: {},
});

// ---------------------------------------------------------------------------
// Banco de dados em arquivo JSON (gravação atômica e serializada)
// ---------------------------------------------------------------------------

let db;
let writeChain = Promise.resolve();

async function loadDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const raw = JSON.parse(await fs.readFile(dbFile, "utf8"));
    const base = defaultDb();
    db = { ...base, ...raw, settings: { ...base.settings, ...raw.settings }, google: { ...base.google, ...raw.google }, push: { ...base.push, ...raw.push } };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    db = defaultDb();
  }
  if (!db.push.vapid) {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      db.push.vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    } else {
      db.push.vapid = webpush.generateVAPIDKeys();
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${allowedEmail || "rotina@example.com"}`, db.push.vapid.publicKey, db.push.vapid.privateKey);
  await saveDb();
}

function saveDb() {
  writeChain = writeChain.then(async () => {
    const tmp = `${dbFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, dbFile);
  }).catch((error) => console.error("Falha ao salvar banco:", error));
  return writeChain;
}

// ---------------------------------------------------------------------------
// Datas e fuso horário
// ---------------------------------------------------------------------------

const partsCache = new Map();
function formatterFor(tz) {
  if (!partsCache.has(tz)) {
    partsCache.set(tz, new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }));
  }
  return partsCache.get(tz);
}

function zonedParts(date, tz) {
  const p = Object.fromEntries(formatterFor(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function tzOffsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - date.getTime()) / 60000);
}

function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offset = tzOffsetMinutes(new Date(guess), tz);
  let ts = guess - offset * 60000;
  const offset2 = tzOffsetMinutes(new Date(ts), tz);
  if (offset2 !== offset) ts = guess - offset2 * 60000;
  return new Date(ts);
}

const tz = () => db.settings.timezone || "America/Sao_Paulo";
const today = () => zonedParts(new Date(), tz()).date;
const weekday = (dateStr) => new Date(`${dateStr}T12:00:00Z`).getUTCDay();

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMinutes(dateStr, timeStr, minutes) {
  const [h, mi] = timeStr.split(":").map(Number);
  const total = h * 60 + mi + minutes;
  const dayShift = Math.floor(total / 1440);
  const rest = ((total % 1440) + 1440) % 1440;
  return { date: addDays(dateStr, dayShift), time: `${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}` };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function str(v, max, fallback = "") {
  if (v === undefined || v === null) return fallback;
  return String(v).trim().slice(0, max);
}
function int(v, min, max, fallback) {
  const n = Number(v);
  if (v === "" || v === null || v === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function required(v, label) {
  if (!v) throw new HttpError(400, `${label} é obrigatório.`);
  return v;
}
const areaId = (v) => (db.areas.some((a) => a.id === v) ? v : "pessoal");
const days = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
const optDate = (v) => (isDate(v) ? v : "");
const optTime = (v) => (isTime(v) ? v : "");
const newId = () => crypto.randomUUID();

const sanitizers = {
  routines(b, prev) {
    const selectedDays = days(b.days);
    if (!selectedDays.length) throw new HttpError(400, "Escolha pelo menos um dia da semana.");
    return {
      title: required(str(b.title, 120), "Título"),
      area: areaId(b.area),
      days: selectedDays,
      start: required(optTime(b.start), "Horário"),
      duration: int(b.duration, 5, 720, 30),
      reminder: int(b.reminder, 0, 240, null),
      notes: str(b.notes, 2000),
      active: b.active !== false,
      gcal: b.gcal !== false,
      startDate: optDate(b.startDate) || prev?.startDate || today(),
    };
  },
  tasks(b, prev) {
    const done = Boolean(b.done);
    return {
      title: required(str(b.title, 160), "Título"),
      area: areaId(b.area),
      date: optDate(b.date),
      start: optTime(b.start),
      duration: int(b.duration, 5, 720, 30),
      reminder: int(b.reminder, 0, 240, null),
      notes: str(b.notes, 2000),
      priority: Boolean(b.priority),
      gcal: b.gcal !== false,
      done,
      doneAt: done ? (prev?.done ? prev.doneAt : today()) : "",
    };
  },
  habits(b) {
    const selectedDays = days(b.days);
    return {
      title: required(str(b.title, 120), "Título"),
      area: areaId(b.area),
      days: selectedDays.length ? selectedDays : [0, 1, 2, 3, 4, 5, 6],
    };
  },
  posts(b, prev) {
    const publishAt = typeof b.publishAt === "string" && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(b.publishAt) ? b.publishAt : "";
    const stage = POST_STAGES.includes(b.stage) ? b.stage : "ideia";
    return {
      title: required(str(b.title, 160), "Título"),
      format: POST_FORMATS.includes(b.format) ? b.format : "reels",
      stage,
      publishAt,
      reminder: int(b.reminder, 0, 240, null),
      notes: str(b.notes, 4000),
      caption: str(b.caption, 4000),
      gcal: b.gcal !== false,
      postedAt: stage === "postado" ? (prev?.stage === "postado" ? prev.postedAt : today()) : "",
    };
  },
};

// ---------------------------------------------------------------------------
// Google OAuth + Google Agenda
// ---------------------------------------------------------------------------

const googleConnected = () => Boolean(db.google.refreshToken);

async function googleAccessToken() {
  if (!googleConfigured || !db.google.refreshToken) return null;
  if (db.google.accessToken && db.google.expiresAt > Date.now() + 60_000) return db.google.accessToken;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: db.google.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (data.error === "invalid_grant") {
      db.google.refreshToken = "";
      db.google.error = "O acesso ao Google expirou ou foi revogado. Conecte de novo em Ajustes.";
      await saveDb();
    }
    throw new Error(`Google token: ${data.error || response.status}`);
  }
  db.google.accessToken = data.access_token;
  db.google.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  db.google.error = "";
  return data.access_token;
}

async function gcal(method, apiPath, body) {
  const token = await googleAccessToken();
  if (!token) throw new Error("Google Agenda não conectado");
  const response = await fetch(`https://www.googleapis.com/calendar/v3${apiPath}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `Google Agenda: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

const calendarPath = () => `/calendars/${encodeURIComponent(db.settings.calendarId || "primary")}/events`;

function eventReminders(minutes) {
  if (!db.settings.gcalReminders || !minutes) return { useDefault: false, overrides: [] };
  return { useDefault: false, overrides: [{ method: "popup", minutes }] };
}

function firstMatchingDate(fromDate, weekdays) {
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(fromDate, i);
    if (weekdays.includes(weekday(d))) return d;
  }
  return fromDate;
}

function eventBodyFor(kind, item) {
  const area = db.areas.find((a) => a.id === item.area);
  const privateProps = { rotinaApp: "1", rotinaKind: kind, rotinaId: item.id };
  const base = {
    colorId: area?.gcalColorId,
    extendedProperties: { private: privateProps },
  };
  const reminder = item.reminder ?? db.settings.defaultReminder;
  if (kind === "routine") {
    const startDate = firstMatchingDate(item.startDate || today(), item.days);
    const end = addMinutes(startDate, item.start, item.duration);
    return {
      ...base,
      summary: item.title,
      description: `${item.notes ? `${item.notes}\n\n` : ""}Rotina (${area?.name || item.area}) criada no app Rotina.`,
      start: { dateTime: `${startDate}T${item.start}:00`, timeZone: tz() },
      end: { dateTime: `${end.date}T${end.time}:00`, timeZone: tz() },
      recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${item.days.map((d) => RRULE_DAYS[d]).join(",")}`],
      reminders: eventReminders(reminder),
    };
  }
  if (kind === "task") {
    const timing = item.start
      ? (() => {
        const end = addMinutes(item.date, item.start, item.duration);
        return { start: { dateTime: `${item.date}T${item.start}:00`, timeZone: tz() }, end: { dateTime: `${end.date}T${end.time}:00`, timeZone: tz() } };
      })()
      : { start: { date: item.date }, end: { date: addDays(item.date, 1) } };
    return {
      ...base,
      summary: `${item.done ? "✓ " : ""}${item.title}`,
      description: `${item.notes ? `${item.notes}\n\n` : ""}Tarefa (${area?.name || item.area}) criada no app Rotina.`,
      ...timing,
      reminders: eventReminders(item.start ? reminder : 0),
    };
  }
  const [date, time] = item.publishAt.split("T");
  const end = addMinutes(date, time, 30);
  return {
    ...base,
    colorId: db.areas.find((a) => a.id === "conteudo")?.gcalColorId,
    summary: `📱 Postar ${item.format}: ${item.title}`,
    description: [item.caption && `Legenda:\n${item.caption}`, item.notes && `Notas:\n${item.notes}`, "Post planejado no app Rotina."].filter(Boolean).join("\n\n"),
    start: { dateTime: `${date}T${time}:00`, timeZone: tz() },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone: tz() },
    reminders: eventReminders(reminder),
  };
}

function shouldHaveEvent(kind, item) {
  if (!item || item.gcal === false) return false;
  if (kind === "routine") return item.active && item.days.length > 0;
  if (kind === "task") return Boolean(item.date);
  return Boolean(item.publishAt);
}

async function deleteEvent(eventId) {
  if (!eventId) return;
  try {
    await gcal("DELETE", `${calendarPath()}/${encodeURIComponent(eventId)}`);
  } catch (error) {
    if (error.status !== 404 && error.status !== 410) throw error;
  }
}

async function syncItem(kind, item) {
  if (!googleConnected()) return;
  try {
    if (!shouldHaveEvent(kind, item)) {
      await deleteEvent(item.gcalEventId);
      item.gcalEventId = "";
    } else {
      const body = eventBodyFor(kind, item);
      let event = null;
      if (item.gcalEventId) {
        try {
          event = await gcal("PUT", `${calendarPath()}/${encodeURIComponent(item.gcalEventId)}`, body);
        } catch (error) {
          if (error.status !== 404 && error.status !== 410) throw error;
        }
      }
      if (!event) event = await gcal("POST", calendarPath(), body);
      item.gcalEventId = event.id;
    }
    item.gcalError = "";
  } catch (error) {
    item.gcalError = error.message;
    console.error(`Sync ${kind} ${item.id}:`, error.message);
  }
  eventCache.clear();
}

const KIND_BY_COLLECTION = { routines: "routine", tasks: "task", posts: "post" };

function syncInBackground(collection, item, previousEventId) {
  const kind = KIND_BY_COLLECTION[collection];
  if (!kind || !googleConnected()) return;
  (async () => {
    if (!item) {
      await deleteEvent(previousEventId).catch((e) => console.error("Remover evento:", e.message));
      eventCache.clear();
      return;
    }
    await syncItem(kind, item);
    await saveDb();
  })();
}

async function syncAll() {
  for (const [collection, kind] of Object.entries(KIND_BY_COLLECTION)) {
    for (const item of db[collection]) await syncItem(kind, item);
  }
  await saveDb();
}

// Eventos do Google Agenda (os que não foram criados pelo app) para um dia.
const eventCache = new Map();

async function googleEventsFor(dateStr) {
  if (!googleConnected()) return [];
  const cached = eventCache.get(dateStr);
  if (cached && cached.at > Date.now() - 5 * 60_000) return cached.events;
  const params = new URLSearchParams({
    timeMin: zonedToUtc(dateStr, "00:00", tz()).toISOString(),
    timeMax: zonedToUtc(addDays(dateStr, 1), "00:00", tz()).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    timeZone: tz(),
  });
  try {
    const data = await gcal("GET", `${calendarPath()}?${params}`);
    const events = (data.items || [])
      .filter((e) => e.status !== "cancelled")
      .filter((e) => e.extendedProperties?.private?.rotinaApp !== "1")
      .filter((e) => !(e.attendees || []).some((a) => a.self && a.responseStatus === "declined"))
      .map((e) => {
        const allDay = Boolean(e.start?.date);
        let start = "";
        let duration = 0;
        if (!allDay) {
          const s = new Date(e.start.dateTime);
          const en = new Date(e.end?.dateTime || e.start.dateTime);
          const local = zonedParts(s, tz());
          start = local.date === dateStr ? local.time : "00:00";
          duration = Math.max(0, Math.round((en - s) / 60000));
        }
        return {
          kind: "event",
          key: `g:${e.id}:${dateStr}`,
          id: e.id,
          title: e.summary || "(sem título)",
          area: "agenda",
          start,
          duration,
          allDay,
          link: e.htmlLink,
          meet: e.hangoutLink || "",
          location: e.location || "",
        };
      });
    eventCache.set(dateStr, { at: Date.now(), events });
    return events;
  } catch (error) {
    console.error("Ler Google Agenda:", error.message);
    return cached?.events || [];
  }
}

// ---------------------------------------------------------------------------
// Montagem do dia
// ---------------------------------------------------------------------------

async function buildDay(dateStr, { includeGoogle = true } = {}) {
  const wd = weekday(dateStr);
  const items = [];
  for (const r of db.routines) {
    if (!r.active || !r.days.includes(wd) || (r.startDate && r.startDate > dateStr)) continue;
    const key = `r:${r.id}:${dateStr}`;
    items.push({ kind: "routine", key, id: r.id, title: r.title, area: r.area, start: r.start, duration: r.duration, reminder: r.reminder, notes: r.notes, status: db.completions[key]?.status || "" });
  }
  for (const t of db.tasks) {
    if (t.date !== dateStr) continue;
    items.push({ kind: "task", key: `t:${t.id}`, id: t.id, title: t.title, area: t.area, start: t.start, duration: t.duration, reminder: t.reminder, notes: t.notes, priority: t.priority, status: t.done ? "done" : "" });
  }
  for (const p of db.posts) {
    if (!p.publishAt || !p.publishAt.startsWith(dateStr)) continue;
    items.push({ kind: "post", key: `p:${p.id}`, id: p.id, title: `Postar ${p.format}: ${p.title}`, area: "conteudo", start: p.publishAt.slice(11), duration: 30, reminder: p.reminder, stage: p.stage, status: p.stage === "postado" ? "done" : "" });
  }
  if (includeGoogle) items.push(...(await googleEventsFor(dateStr)));
  items.sort((a, b) => (a.start || "99:99").localeCompare(b.start || "99:99") || a.title.localeCompare(b.title));
  return items;
}

function streak(habit, upTo) {
  const checks = db.checkins[habit.id] || {};
  let count = 0;
  let d = checks[upTo] ? upTo : addDays(upTo, -1);
  for (let i = 0; i < 400; i += 1) {
    if (habit.days.includes(weekday(d))) {
      if (!checks[d]) break;
      count += 1;
    }
    d = addDays(d, -1);
  }
  return count;
}

function weeklyReport(endDate) {
  const start = addDays(endDate, -6);
  const inRange = (d) => d >= start && d <= endDate;
  const minutes = Object.fromEntries(db.areas.map((a) => [a.id, 0]));
  const planned = Object.fromEntries(db.areas.map((a) => [a.id, 0]));
  let doneCount = 0;
  let plannedCount = 0;
  let skipped = 0;
  const perDay = [];
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(start, i);
    const wd = weekday(d);
    let dayDone = 0;
    let dayPlanned = 0;
    for (const r of db.routines) {
      if (!r.active || !r.days.includes(wd) || (r.startDate && r.startDate > d)) continue;
      const status = db.completions[`r:${r.id}:${d}`]?.status;
      plannedCount += 1; dayPlanned += 1;
      planned[r.area] = (planned[r.area] || 0) + r.duration;
      if (status === "done") { doneCount += 1; dayDone += 1; minutes[r.area] = (minutes[r.area] || 0) + r.duration; }
      if (status === "skipped") skipped += 1;
    }
    for (const t of db.tasks) {
      if (t.date === d) { plannedCount += 1; dayPlanned += 1; planned[t.area] = (planned[t.area] || 0) + t.duration; }
      if (t.done && t.doneAt === d) {
        doneCount += 1; dayDone += 1;
        minutes[t.area] = (minutes[t.area] || 0) + t.duration;
        if (t.date !== d) { plannedCount += 1; dayPlanned += 1; }
      }
    }
    perDay.push({ date: d, label: DAY_NAMES[wd], done: dayDone, planned: dayPlanned });
  }
  const posted = db.posts.filter((p) => p.postedAt && inRange(p.postedAt)).length;
  let habitDue = 0;
  let habitDone = 0;
  for (const h of db.habits) {
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(start, i);
      if (!h.days.includes(weekday(d))) continue;
      habitDue += 1;
      if (db.checkins[h.id]?.[d]) habitDone += 1;
    }
  }
  const reviews = Object.keys(db.reviews).filter(inRange).length;
  return { start, end: endDate, minutes, planned, doneCount, plannedCount, skipped, perDay, posted, habitDue, habitDone, reviews };
}

// ---------------------------------------------------------------------------
// Notificações push (agendador)
// ---------------------------------------------------------------------------

async function sendPush(payload) {
  const subs = db.push.subscriptions;
  if (!subs.length) return 0;
  let delivered = 0;
  let changed = false;
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      delivered += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        sub.dead = true;
        changed = true;
      } else {
        console.error("Push falhou:", error.statusCode, error.body || error.message);
      }
    }
  }));
  if (changed) {
    db.push.subscriptions = subs.filter((s) => !s.dead);
    await saveDb();
  }
  return delivered;
}

async function markSent(key) {
  if (db.sent[key]) return false;
  db.sent[key] = Date.now();
  await saveDb();
  return true;
}

const areaName = (id) => (id === "agenda" ? "Agenda" : db.areas.find((a) => a.id === id)?.name || "");

async function schedulerTick() {
  if (!db.push.subscriptions.length) return;
  const now = new Date();
  const local = zonedParts(now, tz());
  const dates = [local.date, addDays(local.date, 1)];
  for (const date of dates) {
    const items = await buildDay(date, { includeGoogle: db.settings.notifyCalendarEvents });
    for (const item of items) {
      if (!item.start || item.allDay || item.status) continue;
      const startAt = zonedToUtc(date, item.start, tz());
      const reminder = item.reminder ?? db.settings.defaultReminder;
      const label = areaName(item.area);
      if (reminder > 0) {
        const preAt = new Date(startAt.getTime() - reminder * 60000);
        if (now >= preAt && now < startAt && await markSent(`pre:${item.key}`)) {
          await sendPush({ title: `Em ${reminder} min · ${label}`, body: `${item.start} — ${item.title}`, tag: item.key, url: `/?date=${date}` });
        }
      }
      if (now >= startAt && now < new Date(startAt.getTime() + 10 * 60000) && await markSent(`start:${item.key}`)) {
        const body = item.kind === "event"
          ? `${item.title}${item.meet ? " · tem link do Meet" : ""}`
          : `${item.title} (${item.duration} min). Só começa: os primeiros 5 minutos são os mais difíceis.`;
        await sendPush({ title: `Agora · ${label}`, body, tag: item.key, url: `/?date=${date}`, key: item.kind === "event" ? "" : item.key, actions: item.kind === "event" ? [] : [{ action: "done", title: "Feito" }, { action: "skip", title: "Pular" }] });
      }
    }
  }

  const minutesNow = local.h * 60 + local.mi;
  const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  if (isTime(db.settings.morningTime)) {
    const target = toMinutes(db.settings.morningTime);
    if (minutesNow >= target && minutesNow < target + 90 && await markSent(`morning:${local.date}`)) {
      const items = (await buildDay(local.date)).filter((i) => i.kind !== "event");
      const overdue = db.tasks.filter((t) => !t.done && t.date && t.date < local.date).length;
      const first = items.find((i) => i.start && !i.status);
      const body = items.length
        ? `${items.length} ${items.length === 1 ? "bloco" : "blocos"} hoje${first ? `. Primeiro: ${first.start} ${first.title}` : ""}${overdue ? `. ${overdue} atrasada(s) esperando.` : "."}`
        : "Nada planejado ainda. Abra o app e defina as 3 prioridades do dia.";
      await sendPush({ title: "Bom dia! Seu plano de hoje", body, tag: `morning:${local.date}`, url: "/" });
    }
  }
  if (isTime(db.settings.reviewTime)) {
    const target = toMinutes(db.settings.reviewTime);
    if (minutesNow >= target && minutesNow < target + 120 && !db.reviews[local.date] && await markSent(`review:${local.date}`)) {
      await sendPush({ title: "Revisão do dia (2 min)", body: "O que você fez, o que empurrou e as 3 prioridades de amanhã.", tag: `review:${local.date}`, url: "/#revisao" });
    }
  }

  const cutoff = Date.now() - 3 * 86400000;
  let pruned = false;
  for (const [key, at] of Object.entries(db.sent)) {
    if (at < cutoff) { delete db.sent[key]; pruned = true; }
  }
  if (pruned) await saveDb();
}

let tickRunning = false;
function startScheduler() {
  setInterval(async () => {
    if (tickRunning) return;
    tickRunning = true;
    try { await schedulerTick(); } catch (error) { console.error("Agendador:", error); } finally { tickRunning = false; }
  }, 30_000);
}

// ---------------------------------------------------------------------------
// HTTP: utilitários, sessão e rotas
// ---------------------------------------------------------------------------

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}

function cookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureCookies ? "; Secure" : ""}`;
}

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

async function createSession(res) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  for (const [key, s] of Object.entries(db.sessions)) if (s.expiresAt < now) delete db.sessions[key];
  db.sessions[hashToken(token)] = { createdAt: now, expiresAt: now + SESSION_DAYS * 86400000 };
  await saveDb();
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

function isAuthed(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const session = db.sessions[hashToken(token)];
  return Boolean(session && session.expiresAt > Date.now());
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...headers });
  res.end();
}

async function readJson(req) {
  if (!(req.headers["content-type"] || "").includes("application/json")) throw new HttpError(415, "Envie JSON.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, "Requisição muito grande.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "JSON inválido."); }
}

const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, since: now };
  if (now - entry.since > 15 * 60000) { entry.count = 0; entry.since = now; }
  entry.count += 1;
  loginAttempts.set(ip, entry);
  if (entry.count > 10) throw new HttpError(429, "Muitas tentativas. Espere 15 minutos.");
}

function publicState() {
  const since = addDays(today(), -60);
  return {
    settings: db.settings,
    areas: db.areas,
    routines: db.routines,
    tasks: db.tasks,
    habits: db.habits.map((h) => ({ ...h, streak: streak(h, today()) })),
    posts: db.posts,
    checkins: db.checkins,
    reviews: Object.fromEntries(Object.entries(db.reviews).filter(([d]) => d >= since)),
    today: today(),
    google: { configured: googleConfigured, connected: googleConnected(), email: db.google.email, error: db.google.error },
    push: { publicKey: db.push.vapid.publicKey, devices: db.push.subscriptions.length },
  };
}

async function handleGoogleStart(req, res) {
  if (!googleConfigured) return sendJson(res, 400, { error: "Login com Google não configurado no servidor." });
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: `${appUrl}/auth/google/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (allowedEmail) params.set("login_hint", allowedEmail);
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, { "set-cookie": cookie("rotina_oauth", state, 600) });
}

async function handleGoogleCallback(req, res, url) {
  const fail = (msg) => redirect(res, `/?erro=${encodeURIComponent(msg)}`, { "set-cookie": cookie("rotina_oauth", "", 0) });
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return fail("Login com Google cancelado.");
  if (!state || state !== parseCookies(req).rotina_oauth || !code) return fail("Sessão de login inválida. Tente de novo.");
  if (!allowedEmail) return fail("Defina ALLOWED_EMAIL no servidor com o seu e-mail antes de entrar.");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: googleClientId, client_secret: googleClientSecret, redirect_uri: `${appUrl}/auth/google/callback`, grant_type: "authorization_code" }),
  });
  const tokens = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) return fail("O Google recusou o login. Confira o Client ID/Secret e a URL de retorno.");

  const infoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` } });
  const info = await infoResponse.json().catch(() => ({}));
  if (!info.email_verified || String(info.email).toLowerCase() !== allowedEmail) return fail("Esta conta Google não tem acesso a este app.");

  const grantedScopes = String(tokens.scope || "").split(" ");
  db.google = {
    ...db.google,
    email: info.email,
    name: info.name || "",
    picture: info.picture || "",
    refreshToken: tokens.refresh_token || db.google.refreshToken,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
    error: grantedScopes.includes("https://www.googleapis.com/auth/calendar.events") ? "" : "Você não liberou o acesso à Agenda. Conecte de novo e marque a permissão do Google Agenda.",
  };
  const sessionCookie = await createSession(res);
  redirect(res, "/", { "set-cookie": [sessionCookie, cookie("rotina_oauth", "", 0)] });
  if (googleConnected()) syncAll().catch((e) => console.error("Sync inicial:", e.message));
}

const COLLECTIONS = new Set(["routines", "tasks", "habits", "posts"]);

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === "/api/me" && method === "GET") {
    return sendJson(res, 200, { authed: isAuthed(req), googleLogin: googleConfigured, passwordLogin: Boolean(loginPassword) });
  }
  if (pathname === "/api/login" && method === "POST") {
    if (!loginPassword) throw new HttpError(400, "Login por senha desativado.");
    checkRateLimit(req.socket.remoteAddress);
    const body = await readJson(req);
    const given = crypto.createHash("sha256").update(String(body.password || "")).digest();
    const expected = crypto.createHash("sha256").update(loginPassword).digest();
    if (!crypto.timingSafeEqual(given, expected)) throw new HttpError(401, "Senha incorreta.");
    return sendJson(res, 200, { ok: true }, { "set-cookie": await createSession(res) });
  }

  if (!isAuthed(req)) throw new HttpError(401, "Faça login.");
  if (method !== "GET" && method !== "HEAD" && !(req.headers["content-type"] || "").includes("application/json")) throw new HttpError(415, "Envie JSON.");

  if (pathname === "/api/logout" && method === "POST") {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) delete db.sessions[hashToken(token)];
    await saveDb();
    return sendJson(res, 200, { ok: true }, { "set-cookie": cookie(SESSION_COOKIE, "", 0) });
  }
  if (pathname === "/api/state" && method === "GET") return sendJson(res, 200, publicState());

  if (pathname === "/api/day" && method === "GET") {
    const date = isDate(url.searchParams.get("date")) ? url.searchParams.get("date") : today();
    const items = await buildDay(date);
    const overdue = date === today() ? db.tasks.filter((t) => !t.done && t.date && t.date < date).sort((a, b) => a.date.localeCompare(b.date)) : [];
    const inbox = db.tasks.filter((t) => !t.done && !t.date);
    const habits = db.habits.filter((h) => h.days.includes(weekday(date))).map((h) => ({ ...h, checked: Boolean(db.checkins[h.id]?.[date]), streak: streak(h, date) }));
    return sendJson(res, 200, { date, today: today(), items, overdue, inbox, habits, review: db.reviews[date] || null });
  }

  if (pathname === "/api/report" && method === "GET") {
    const end = isDate(url.searchParams.get("end")) ? url.searchParams.get("end") : today();
    return sendJson(res, 200, weeklyReport(end));
  }

  const match = pathname.match(/^\/api\/(routines|tasks|habits|posts)(?:\/([\w-]+))?$/);
  if (match && COLLECTIONS.has(match[1])) {
    const [, collection, id] = match;
    const list = db[collection];
    if (!id && method === "POST") {
      const body = await readJson(req);
      const item = { id: newId(), createdAt: new Date().toISOString(), ...sanitizers[collection](body, null) };
      list.push(item);
      await saveDb();
      syncInBackground(collection, item);
      return sendJson(res, 201, item);
    }
    const index = list.findIndex((x) => x.id === id);
    if (!id || index === -1) throw new HttpError(404, "Item não encontrado.");
    if (method === "PUT") {
      const body = await readJson(req);
      const prev = list[index];
      const item = { ...prev, ...sanitizers[collection]({ ...prev, ...body }, prev) };
      list[index] = item;
      await saveDb();
      syncInBackground(collection, item);
      return sendJson(res, 200, item);
    }
    if (method === "DELETE") {
      const [removed] = list.splice(index, 1);
      if (collection === "habits") delete db.checkins[removed.id];
      if (collection === "routines") for (const key of Object.keys(db.completions)) if (key.startsWith(`r:${removed.id}:`)) delete db.completions[key];
      await saveDb();
      syncInBackground(collection, null, removed.gcalEventId);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === "/api/complete" && method === "POST") {
    const { key, status } = await readJson(req);
    if (typeof key !== "string") throw new HttpError(400, "Chave inválida.");
    const value = status === "done" || status === "skipped" ? status : "";
    const [kind, id] = key.split(":");
    if (kind === "r") {
      if (!/^r:[\w-]+:\d{4}-\d{2}-\d{2}$/.test(key) || !db.routines.some((r) => r.id === id)) throw new HttpError(404, "Rotina não encontrada.");
      if (value) db.completions[key] = { status: value, at: new Date().toISOString() };
      else delete db.completions[key];
    } else if (kind === "t") {
      const task = db.tasks.find((t) => t.id === id);
      if (!task) throw new HttpError(404, "Tarefa não encontrada.");
      task.done = value === "done";
      task.doneAt = task.done ? today() : "";
      syncInBackground("tasks", task);
    } else if (kind === "p") {
      const post = db.posts.find((p) => p.id === id);
      if (!post) throw new HttpError(404, "Post não encontrado.");
      if (value === "done") { post.stage = "postado"; post.postedAt = today(); } else if (post.stage === "postado") { post.stage = "agendado"; post.postedAt = ""; }
      syncInBackground("posts", post);
    } else {
      throw new HttpError(400, "Chave inválida.");
    }
    await saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/checkins" && method === "POST") {
    const { habitId, date, checked } = await readJson(req);
    if (!db.habits.some((h) => h.id === habitId) || !isDate(date)) throw new HttpError(400, "Hábito ou data inválidos.");
    db.checkins[habitId] ||= {};
    if (checked) db.checkins[habitId][date] = true;
    else delete db.checkins[habitId][date];
    await saveDb();
    const habit = db.habits.find((h) => h.id === habitId);
    return sendJson(res, 200, { ok: true, streak: streak(habit, date) });
  }

  const reviewMatch = pathname.match(/^\/api\/reviews\/(\d{4}-\d{2}-\d{2})$/);
  if (reviewMatch && method === "PUT") {
    const date = reviewMatch[1];
    const body = await readJson(req);
    const top3 = (Array.isArray(body.top3) ? body.top3 : []).map((t) => str(t, 160)).filter(Boolean).slice(0, 3);
    db.reviews[date] = {
      wins: str(body.wins, 2000),
      blockers: str(body.blockers, 2000),
      top3,
      energy: int(body.energy, 1, 5, 3),
      savedAt: new Date().toISOString(),
    };
    if (body.createTasks && top3.length) {
      const tomorrow = addDays(date, 1);
      for (const title of top3) {
        if (db.tasks.some((t) => t.date === tomorrow && t.title === title)) continue;
        const task = { id: newId(), createdAt: new Date().toISOString(), ...sanitizers.tasks({ title, date: tomorrow, area: "pessoal", priority: true, gcal: false }, null) };
        db.tasks.push(task);
      }
    }
    await saveDb();
    return sendJson(res, 200, db.reviews[date]);
  }

  if (pathname === "/api/settings" && method === "PUT") {
    const body = await readJson(req);
    const s = db.settings;
    if (body.timezone) {
      try { new Intl.DateTimeFormat("en", { timeZone: body.timezone }); s.timezone = body.timezone; } catch { throw new HttpError(400, "Fuso horário inválido."); }
    }
    if (body.calendarId !== undefined) s.calendarId = str(body.calendarId, 200) || "primary";
    if (body.defaultReminder !== undefined) s.defaultReminder = int(body.defaultReminder, 0, 240, 10);
    if (body.morningTime !== undefined) s.morningTime = optTime(body.morningTime);
    if (body.reviewTime !== undefined) s.reviewTime = optTime(body.reviewTime);
    if (body.notifyCalendarEvents !== undefined) s.notifyCalendarEvents = Boolean(body.notifyCalendarEvents);
    if (body.gcalReminders !== undefined) s.gcalReminders = Boolean(body.gcalReminders);
    eventCache.clear();
    await saveDb();
    return sendJson(res, 200, s);
  }

  if (pathname === "/api/push/subscribe" && method === "POST") {
    const { subscription } = await readJson(req);
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new HttpError(400, "Inscrição inválida.");
    if (!/^https:\/\//.test(subscription.endpoint)) throw new HttpError(400, "Endpoint inválido.");
    const clean = { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, userAgent: str(req.headers["user-agent"], 200), createdAt: new Date().toISOString() };
    db.push.subscriptions = db.push.subscriptions.filter((s) => s.endpoint !== clean.endpoint).concat(clean);
    await saveDb();
    return sendJson(res, 200, { ok: true, devices: db.push.subscriptions.length });
  }
  if (pathname === "/api/push/unsubscribe" && method === "POST") {
    const { endpoint } = await readJson(req);
    db.push.subscriptions = db.push.subscriptions.filter((s) => s.endpoint !== endpoint);
    await saveDb();
    return sendJson(res, 200, { ok: true, devices: db.push.subscriptions.length });
  }
  if (pathname === "/api/push/test" && method === "POST") {
    const delivered = await sendPush({ title: "Teste de alerta ✅", body: "As notificações estão funcionando neste aparelho.", tag: "teste", url: "/" });
    return sendJson(res, 200, { delivered });
  }

  if (pathname === "/api/google/sync" && method === "POST") {
    if (!googleConnected()) throw new HttpError(400, "Conecte o Google Agenda primeiro.");
    await syncAll();
    const errors = ["routines", "tasks", "posts"].flatMap((c) => db[c].filter((i) => i.gcalError).map((i) => `${i.title}: ${i.gcalError}`));
    return sendJson(res, 200, { ok: errors.length === 0, errors });
  }
  if (pathname === "/api/google/disconnect" && method === "POST") {
    const token = db.google.refreshToken;
    db.google = { ...defaultDb().google };
    await saveDb();
    if (token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
    eventCache.clear();
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(404, "Rota não encontrada.");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(req, res, url) {
  let filePath = path.normalize(path.join(publicDir, decodeURIComponent(url.pathname)));
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) filePath = path.join(publicDir, "index.html");
  let stat = await fs.stat(filePath).catch(() => null);
  if (!stat || stat.isDirectory()) {
    filePath = path.join(publicDir, "index.html");
    stat = await fs.stat(filePath);
  }
  const ext = path.extname(filePath);
  const noCache = ext === ".html" || filePath.endsWith("sw.js") || ext === ".webmanifest" || ext === ".js" || ext === ".css";
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": noCache ? "no-cache" : "public, max-age=604800",
    ...(filePath.endsWith("sw.js") ? { "service-worker-allowed": "/" } : {}),
  });
  if (req.method === "HEAD") return res.end();
  res.end(await fs.readFile(filePath));
}

const server = createServer(async (req, res) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("x-frame-options", "DENY");
  const url = new URL(req.url, "http://local");
  try {
    if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true });
    if (url.pathname === "/auth/google") return await handleGoogleStart(req, res);
    if (url.pathname === "/auth/google/callback") return await handleGoogleCallback(req, res, url);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Método não permitido.");
    return await serveStatic(req, res, url);
  } catch (error) {
    if (!(error instanceof HttpError)) console.error(error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error instanceof HttpError ? error.message : "Erro interno." });
  }
});

await loadDb();
startScheduler();
server.listen(port, host, () => {
  console.log(`Rotina rodando em ${appUrl} (porta ${port})`);
  if (!googleConfigured) console.log("Google não configurado: defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.");
  if (googleConfigured && !allowedEmail) console.log("Atenção: defina ALLOWED_EMAIL para liberar o seu login.");
  if (!googleConfigured && !loginPassword) console.log("Nenhum login disponível: configure o Google ou ROTINA_PASSWORD.");
});
