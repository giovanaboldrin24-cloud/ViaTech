// Rotina: app de rotina, foco e conteúdo (PWA sem build, JavaScript puro).

const $view = document.getElementById("view");
const $sheet = document.getElementById("sheet");
const $toast = document.getElementById("toast");

const DAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DAY_LETTER = ["D", "S", "T", "Q", "Q", "S", "S"];
const STAGES = [
  { id: "ideia", label: "Ideia" },
  { id: "roteiro", label: "Roteiro" },
  { id: "gravacao", label: "Gravação" },
  { id: "edicao", label: "Edição" },
  { id: "agendado", label: "Agendado" },
  { id: "postado", label: "Postado" },
];
const FORMATS = [
  { id: "reels", label: "Reels" },
  { id: "carrossel", label: "Carrossel" },
  { id: "stories", label: "Stories" },
  { id: "post", label: "Post" },
  { id: "live", label: "Live" },
];
const REMINDERS = [
  { v: "", label: "Padrão" },
  { v: "0", label: "Só na hora" },
  { v: "5", label: "5 min antes" },
  { v: "10", label: "10 min antes" },
  { v: "15", label: "15 min antes" },
  { v: "30", label: "30 min antes" },
  { v: "60", label: "1 h antes" },
];

// Sugestões de rotinas pensadas para quem concilia SDR + criação de conteúdo.
const TEMPLATES = [
  { title: "Planejar o dia (top 3)", area: "pessoal", days: [1, 2, 3, 4, 5], start: "08:00", duration: 15, notes: "Escolha as 3 coisas que fariam o dia valer a pena. Comece pela mais difícil." },
  { title: "Bloco de prospecção (cold call / cadência)", area: "sdr", days: [1, 2, 3, 4, 5], start: "09:00", duration: 90, notes: "Celular longe, abas fechadas. Meta de ligações/contatos antes de abrir e-mail." },
  { title: "Follow-ups e respostas de leads", area: "sdr", days: [1, 2, 3, 4, 5], start: "11:00", duration: 45 },
  { title: "Atualizar CRM e agendar reuniões", area: "sdr", days: [1, 2, 3, 4, 5], start: "16:30", duration: 30 },
  { title: "Pesquisa de contas / listas", area: "sdr", days: [1, 3], start: "14:00", duration: 60 },
  { title: "Planejar conteúdos da semana", area: "conteudo", days: [0], start: "18:00", duration: 60, notes: "Defina temas, formatos e dias de postagem. Use a aba Conteúdo." },
  { title: "Gravação em lote", area: "conteudo", days: [6], start: "10:00", duration: 120, notes: "Grave vários conteúdos de uma vez para a semana." },
  { title: "Edição de conteúdo", area: "conteudo", days: [2, 4], start: "19:30", duration: 60 },
  { title: "Engajamento (comentários e DMs)", area: "conteudo", days: [1, 2, 3, 4, 5], start: "12:30", duration: 20 },
  { title: "Revisão do dia", area: "pessoal", days: [0, 1, 2, 3, 4, 5, 6], start: "21:30", duration: 10 },
];

const TABS = [
  { id: "hoje", label: "Hoje", icon: '<path d="M7 2v3M17 2v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5z"/><path d="m8.5 14.5 2.5 2.5 4.5-5"/>' },
  { id: "rotinas", label: "Rotinas", icon: '<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="18.5" cy="17" r="2.5"/>' },
  { id: "conteudo", label: "Conteúdo", icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r=".8" fill="currentColor"/>' },
  { id: "habitos", label: "Hábitos", icon: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.7 1.3 2.5 2 2.5 0-3-1-5 1-8z"/>' },
  { id: "revisao", label: "Revisão", icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
];

const state = {
  data: null,
  view: "hoje",
  date: null,
  filter: "all",
  day: null,
  reviewDate: null,
  swReg: null,
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined || method !== "GET" ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : method !== "GET" ? "{}" : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login") {
    renderLogin(await (await fetch("/api/me")).json());
    throw new Error("Faça login.");
  }
  if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
  return data;
}

let toastTimer;
function toast(message) {
  $toast.textContent = message;
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 2600);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (dateStr) => new Date(`${dateStr}T12:00:00Z`).getUTCDay();

function nowInTz() {
  const tz = state.data?.settings.timezone || "America/Sao_Paulo";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, minutes: +p.hour * 60 + +p.minute };
}
const todayStr = () => nowInTz().date;
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function longDate(dateStr) {
  const s = new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function shortDate(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
function relativeLabel(dateStr) {
  const t = todayStr();
  if (dateStr === t) return "Hoje";
  if (dateStr === addDays(t, 1)) return "Amanhã";
  if (dateStr === addDays(t, -1)) return "Ontem";
  return DAY_SHORT[weekday(dateStr)];
}
function daysLabel(days) {
  const key = [...days].sort().join("");
  if (key === "0123456") return "Todos os dias";
  if (key === "12345") return "Seg a Sex";
  if (key === "06") return "Fins de semana";
  return days.map((d) => DAY_SHORT[d]).join(", ");
}
function duration(min) {
  if (!min) return "";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;
}

const areas = () => state.data?.areas || [];
const areaName = (id) => (id === "agenda" ? "Agenda" : areas().find((a) => a.id === id)?.name || id);
const areaChip = (id) => `<span class="chip area-${esc(id)}"><span class="dot"></span>${esc(areaName(id))}</span>`;

function icon(paths, size = 20) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
const CHECK = icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 18);

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

function renderNav() {
  const buttons = TABS.map((t) => `<button type="button" data-go="${t.id}" ${state.view === t.id ? 'aria-current="page"' : ""}>${icon(t.icon, 22)}<span>${t.label}</span></button>`).join("");
  document.getElementById("bottombar").innerHTML = buttons;
  document.getElementById("tabs").innerHTML = TABS.map((t) => `<button type="button" data-go="${t.id}" ${state.view === t.id ? 'aria-current="page"' : ""}>${t.label}</button>`).join("");
}

function go(view) {
  state.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, "", `${location.pathname}${location.search}#${view}`);
  render();
  window.scrollTo(0, 0);
}

async function refreshState() {
  state.data = await api("/api/state");
}

async function render() {
  document.getElementById("app").hidden = false;
  document.querySelector(".topbar").hidden = false;
  document.getElementById("bottombar").hidden = false;
  renderNav();
  const views = { hoje: renderHoje, rotinas: renderRotinas, conteudo: renderConteudo, habitos: renderHabitos, revisao: renderRevisao, ajustes: renderAjustes };
  try {
    await (views[state.view] || renderHoje)();
  } catch (error) {
    if (error.message !== "Faça login.") $view.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function renderLogin(me) {
  document.querySelector(".topbar").hidden = true;
  document.getElementById("bottombar").hidden = true;
  const params = new URLSearchParams(location.search);
  const error = params.get("erro");
  $view.innerHTML = `
    <div class="login card">
      <img src="/icons/icon-192.png" alt="" width="72" height="72">
      <h1>Rotina</h1>
      <p>Seu dia organizado entre SDR, Instagram e vida pessoal, sincronizado com o Google Agenda.</p>
      ${error ? `<div class="notice error">${esc(error)}</div>` : ""}
      ${me.googleLogin ? `<a class="google-btn" href="/auth/google">${googleG()} Entrar com Google</a>` : ""}
      ${me.passwordLogin ? `
        <form id="login-form">
          <input type="password" name="password" placeholder="Senha" autocomplete="current-password" required>
          <button class="btn primary btn-block" type="submit">Entrar com senha</button>
        </form>` : ""}
      ${!me.googleLogin && !me.passwordLogin ? '<div class="notice warn">Nenhum login configurado no servidor. Veja o README (GOOGLE_CLIENT_ID / ROTINA_PASSWORD).</div>' : ""}
    </div>`;
  document.getElementById("login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/login", { method: "POST", body: { password: event.target.password.value } });
      await start();
    } catch (err) {
      toast(err.message);
    }
  });
}

function googleG() {
  return '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
}

// ---------------------------------------------------------------------------
// HOJE
// ---------------------------------------------------------------------------

async function renderHoje() {
  state.date ||= todayStr();
  const day = await api(`/api/day?date=${state.date}`);
  state.day = day;
  const isToday = day.date === day.today;
  const now = nowInTz();
  const filter = state.filter;
  const visible = day.items.filter((i) => filter === "all" || i.area === filter);
  const completable = day.items.filter((i) => i.kind !== "event");
  const doneCount = completable.filter((i) => i.status === "done").length;
  const pct = completable.length ? Math.round((doneCount / completable.length) * 100) : 0;

  let focus = null;
  let focusLabel = "";
  if (isToday) {
    const timed = day.items.filter((i) => i.start && !i.allDay && !i.status);
    focus = timed.find((i) => toMin(i.start) <= now.minutes && now.minutes < toMin(i.start) + (i.duration || 30));
    focusLabel = "Agora";
    if (!focus) {
      focus = timed.find((i) => toMin(i.start) > now.minutes);
      if (focus) {
        const wait = toMin(focus.start) - now.minutes;
        focusLabel = `Próximo · em ${wait < 60 ? `${wait} min` : duration(wait)}`;
      }
    }
    if (!focus) {
      const late = timed.filter((i) => i.kind !== "event" && toMin(i.start) + (i.duration || 30) <= now.minutes);
      if (late.length) { focus = late[0]; focusLabel = "Ficou para trás — faça ou pule"; }
    }
  }

  const g = state.data.google;
  const pushOn = await pushEnabled();
  const notices = [];
  if (g.error) notices.push(`<div class="notice error">${esc(g.error)} <a href="#ajustes" data-go="ajustes">Ajustes</a></div>`);
  else if (g.configured && !g.connected) notices.push('<div class="notice">Conecte o Google Agenda para ver seus compromissos aqui. <a href="#ajustes" data-go="ajustes">Conectar</a></div>');
  if (!pushOn) notices.push(`<div class="notice warn">Os alertas estão desligados neste aparelho. <a href="#ajustes" data-go="ajustes">Ativar notificações</a></div>`);

  $view.innerHTML = `
    <div class="day-nav">
      <button class="icon-btn" data-action="day-prev" aria-label="Dia anterior">${icon('<path d="m15 6-6 6 6 6"/>')}</button>
      <h1>${esc(relativeLabel(day.date))}<span class="sub">${esc(longDate(day.date))}</span></h1>
      ${isToday ? "" : '<button class="btn sm" data-action="day-today">Hoje</button>'}
      <button class="icon-btn" data-action="day-next" aria-label="Próximo dia">${icon('<path d="m9 6 6 6-6 6"/>')}</button>
    </div>
    <div class="stack" style="margin-top:12px">
      ${notices.join("")}
      <div>
        <div class="spread small muted" style="margin-bottom:6px"><span>${doneCount} de ${completable.length} feitos</span><span>${pct}%</span></div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso do dia"><span style="width:${pct}%"></span></div>
      </div>
      ${focus ? focusCard(focus, focusLabel, day.date) : ""}
    </div>

    <div class="grid-2">
      <div>
        <div class="section">
          <div class="spread">
            <h2>Agenda do dia</h2>
            <button class="btn sm" data-action="new-task" data-date="${day.date}">+ Tarefa</button>
          </div>
          <div class="filters" role="group" aria-label="Filtrar por área" style="margin-bottom:10px">
            ${[{ id: "all", name: "Tudo" }, ...areas(), { id: "agenda", name: "Agenda" }].map((a) => `<button class="chip ${a.id === "all" ? "" : `area-${a.id}`}" data-action="filter" data-area="${a.id}" aria-pressed="${filter === a.id}">${esc(a.name)}</button>`).join("")}
          </div>
          <form class="quick-add" id="quick-add">
            <input type="text" name="title" placeholder="Adicionar tarefa rápida… (ex.: 14:30 ligar p/ lead)" aria-label="Tarefa rápida" autocomplete="off">
            <button class="btn primary" type="submit" aria-label="Adicionar">+</button>
          </form>
          <div class="timeline" style="margin-top:10px">
            ${visible.length ? visible.map((i) => itemRow(i, isToday && focus?.key === i.key && focusLabel === "Agora")).join("") : `<div class="empty">Nada por aqui ${filter === "all" ? "ainda" : "nesta área"}.<br><span class="small">Cadastre rotinas na aba Rotinas ou adicione uma tarefa acima.</span></div>`}
          </div>
        </div>
      </div>
      <div>
        ${day.overdue.length ? `
          <div class="section">
            <div class="spread"><h2>Atrasadas <span class="chip">${day.overdue.length}</span></h2><button class="btn sm" data-action="overdue-all">Trazer todas p/ hoje</button></div>
            <div class="list">${day.overdue.map((t) => taskRow(t, true)).join("")}</div>
          </div>` : ""}
        <div class="section">
          <div class="spread"><h2>Hábitos</h2><button class="btn sm ghost" data-go="habitos">Ver todos</button></div>
          ${day.habits.length ? `<div class="list">${day.habits.map((h) => `
            <div class="list-row">
              <button class="check" data-action="habit-check" data-id="${h.id}" data-checked="${h.checked}" aria-pressed="${h.checked}" aria-label="Marcar ${esc(h.title)}">${CHECK}</button>
              <div class="grow"><div class="title">${esc(h.title)}</div></div>
              <span class="streak" title="Sequência">🔥 ${h.streak}</span>
            </div>`).join("")}</div>` : '<div class="empty small">Nenhum hábito para este dia.</div>'}
        </div>
        ${day.inbox.length ? `
          <div class="section">
            <div class="spread"><h2>Sem data</h2></div>
            <div class="list">${day.inbox.map((t) => taskRow(t, true)).join("")}</div>
          </div>` : ""}
        ${isToday ? `
          <div class="section">
            <div class="card stack">
              <div class="spread"><h3>Fechar o dia</h3>${day.review ? '<span class="chip area-pessoal">Feita ✓</span>' : ""}</div>
              <p class="muted small" style="margin:0">2 minutos: o que deu certo, o que travou e as 3 prioridades de amanhã.</p>
              <button class="btn" data-go="revisao">Fazer revisão</button>
            </div>
          </div>` : ""}
      </div>
    </div>`;

  document.getElementById("quick-add").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = event.target.title;
    let text = input.value.trim();
    if (!text) return;
    let start = "";
    const m = text.match(/^(\d{1,2})[:h](\d{2})?\s+(.+)$/i);
    if (m && +m[1] < 24) { start = `${m[1].padStart(2, "0")}:${m[2] || "00"}`; text = m[3]; }
    const area = ["sdr", "conteudo", "pessoal"].includes(state.filter) ? state.filter : "pessoal";
    try {
      await api("/api/tasks", { method: "POST", body: { title: text, date: state.date, start, area } });
      input.value = "";
      toast("Tarefa adicionada");
      renderHoje();
    } catch (error) { toast(error.message); }
  });
}

function focusCard(item, label, date) {
  const end = item.start ? fromMin(toMin(item.start) + (item.duration || 0)) : "";
  const actions = item.kind === "event"
    ? `${item.meet ? `<a class="btn primary" href="${esc(item.meet)}" target="_blank" rel="noopener">Entrar no Meet</a>` : ""}${item.link ? `<a class="btn" href="${esc(item.link)}" target="_blank" rel="noopener">Abrir no Agenda</a>` : ""}`
    : `<button class="btn primary" data-action="complete" data-key="${esc(item.key)}" data-status="done">${CHECK} Feito</button>
       <button class="btn" data-action="complete" data-key="${esc(item.key)}" data-status="skipped">Pular</button>`;
  return `
    <div class="card now-card stack">
      <div>
        <div class="now-label">${esc(label)} · ${esc(areaName(item.area))}</div>
        <h2>${esc(item.title)}</h2>
        <div class="muted small">${esc(item.start)}${end && item.duration ? `–${esc(end)}` : ""}${item.notes ? ` · ${esc(item.notes)}` : ""}</div>
      </div>
      <div class="row">${actions}</div>
      ${item.kind !== "event" && label === "Agora" ? '<div class="small muted">Dica anti-procrastinação: comprometa-se só com os primeiros 5 minutos.</div>' : ""}
    </div>`;
}

function itemRow(item, isNow) {
  const statusClass = item.status === "done" ? "is-done" : item.status === "skipped" ? "is-skipped" : "";
  const kindLabel = { routine: "Rotina", task: "Tarefa", post: "Post", event: "Agenda" }[item.kind];
  const time = item.allDay ? "Dia todo" : item.start || "—";
  const controls = item.kind === "event"
    ? (item.meet || item.link ? `<a class="btn sm ghost" href="${esc(item.meet || item.link)}" target="_blank" rel="noopener" aria-label="Abrir">↗</a>` : "")
    : `<div class="actions">
        ${item.status !== "done" ? `<button class="btn sm ghost" data-action="complete" data-key="${esc(item.key)}" data-status="${item.status === "skipped" ? "" : "skipped"}" title="${item.status === "skipped" ? "Desfazer" : "Pular"}">${item.status === "skipped" ? "↺" : "Pular"}</button>` : ""}
        <button class="check" data-action="complete" data-key="${esc(item.key)}" data-status="${item.status === "done" ? "" : "done"}" aria-pressed="${item.status === "done"}" aria-label="Marcar como feito">${CHECK}</button>
      </div>`;
  const editable = item.kind === "task" ? `data-action="edit-task" data-id="${item.id}"` : item.kind === "routine" ? `data-action="edit-routine" data-id="${item.id}"` : item.kind === "post" ? `data-action="edit-post" data-id="${item.id}"` : "";
  return `
    <div class="item ${statusClass} ${isNow ? "is-now" : ""}" data-area="${esc(item.area)}">
      <div class="time">${esc(time)}${item.duration && !item.allDay ? `<small>${duration(item.duration)}</small>` : ""}</div>
      <div ${editable} style="cursor:${editable ? "pointer" : "default"};min-width:0">
        <div class="title">${item.priority ? "⭐ " : ""}${esc(item.title)}</div>
        <div class="meta">${areaChip(item.area)}<span class="small muted">${kindLabel}${item.status === "skipped" ? " · pulado" : ""}${item.location ? ` · ${esc(item.location)}` : ""}</span></div>
      </div>
      ${controls}
    </div>`;
}

function taskRow(task, offerToday) {
  return `
    <div class="list-row">
      <button class="check" data-action="complete" data-key="t:${task.id}" data-status="${task.done ? "" : "done"}" aria-pressed="${task.done}" aria-label="Concluir">${CHECK}</button>
      <div class="grow" data-action="edit-task" data-id="${task.id}" style="cursor:pointer">
        <div class="title">${task.priority ? "⭐ " : ""}${esc(task.title)}</div>
        <div class="row small muted">${areaChip(task.area)}${task.date ? `<span>${esc(relativeLabel(task.date))} ${esc(shortDate(task.date))}${task.start ? ` · ${esc(task.start)}` : ""}</span>` : ""}</div>
      </div>
      ${offerToday ? `<button class="btn sm" data-action="task-today" data-id="${task.id}">Hoje</button>` : ""}
    </div>`;
}

// ---------------------------------------------------------------------------
// ROTINAS
// ---------------------------------------------------------------------------

async function renderRotinas() {
  await refreshState();
  const { routines, tasks } = state.data;
  const t = todayStr();
  const upcoming = tasks.filter((x) => !x.done && x.date && x.date > t).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const byArea = areas().map((a) => ({ area: a, list: routines.filter((r) => r.area === a.id).sort((x, y) => x.start.localeCompare(y.start)) }));
  $view.innerHTML = `
    <div class="spread">
      <h1>Rotinas</h1>
      <div class="row">
        <button class="btn" data-action="new-task">+ Tarefa</button>
        <button class="btn primary" data-action="new-routine">+ Rotina</button>
      </div>
    </div>
    <p class="muted">Blocos que se repetem na semana. Cada rotina vira um evento recorrente no seu Google Agenda e dispara alerta antes de começar.</p>
    ${byArea.map(({ area, list }) => `
      <div class="section">
        <div class="spread"><h2>${areaChip(area.id)}</h2><span class="small muted">${duration(list.filter((r) => r.active).reduce((s, r) => s + r.duration * r.days.length, 0)) || "0 min"} / semana</span></div>
        ${list.length ? `<div class="list">${list.map(routineRow).join("")}</div>` : '<div class="empty small">Nenhuma rotina nesta área.</div>'}
      </div>`).join("")}
    <div class="section">
      <div class="spread"><h2>Próximas tarefas</h2></div>
      ${upcoming.length ? `<div class="list">${upcoming.map((x) => taskRow(x, false)).join("")}</div>` : '<div class="empty small">Nenhuma tarefa agendada para os próximos dias.</div>'}
    </div>
    <div class="section">
      <div class="spread"><h2>Sugestões para começar</h2></div>
      <p class="muted small">Toque para adicionar e ajuste o horário para o seu dia.</p>
      <div class="templates">
        ${TEMPLATES.map((tp, i) => `
          <button class="template" data-action="use-template" data-index="${i}">
            <div class="row">${areaChip(tp.area)}<span class="small muted">${esc(daysLabel(tp.days))} · ${tp.start}</span></div>
            <div class="title" style="margin-top:6px">${esc(tp.title)}</div>
          </button>`).join("")}
      </div>
    </div>`;
}

function routineRow(r) {
  const sync = !state.data.google.connected || !r.gcal ? "" : r.gcalError ? `<span class="chip" title="${esc(r.gcalError)}" style="color:var(--danger)">Erro na Agenda</span>` : r.gcalEventId ? '<span class="chip">✓ Agenda</span>' : '<span class="chip">Sincronizando…</span>';
  return `
    <div class="list-row" style="${r.active ? "" : "opacity:.55"}">
      <div style="font-weight:700;font-variant-numeric:tabular-nums;width:48px">${esc(r.start)}</div>
      <div class="grow" data-action="edit-routine" data-id="${r.id}" style="cursor:pointer">
        <div class="title">${esc(r.title)}</div>
        <div class="row small muted"><span>${esc(daysLabel(r.days))} · ${duration(r.duration)}</span>${sync}${r.active ? "" : '<span class="chip">Pausada</span>'}</div>
      </div>
      <button class="btn sm ghost" data-action="edit-routine" data-id="${r.id}">Editar</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// CONTEÚDO
// ---------------------------------------------------------------------------

async function renderConteudo() {
  await refreshState();
  const posts = state.data.posts;
  const t = todayStr();
  const week = posts.filter((p) => p.publishAt && p.publishAt.slice(0, 10) >= t && p.publishAt.slice(0, 10) <= addDays(t, 6) && p.stage !== "postado").sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  const postedWeek = posts.filter((p) => p.postedAt && p.postedAt >= addDays(t, -6)).length;
  $view.innerHTML = `
    <div class="spread">
      <h1>Conteúdo</h1>
      <button class="btn primary" data-action="new-post">+ Nova ideia</button>
    </div>
    <p class="muted">Do rascunho ao post publicado. Com data de publicação, o post vai para o Google Agenda e você recebe alerta na hora de postar.</p>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><span class="small muted">Ideias no banco</span><b>${posts.filter((p) => p.stage === "ideia").length}</b></div>
      <div class="stat"><span class="small muted">Em produção</span><b>${posts.filter((p) => ["roteiro", "gravacao", "edicao"].includes(p.stage)).length}</b></div>
      <div class="stat"><span class="small muted">Agendados (7 dias)</span><b>${week.length}</b></div>
      <div class="stat"><span class="small muted">Postados (7 dias)</span><b>${postedWeek}</b></div>
    </div>
    ${week.length ? `
      <div class="section">
        <h2 style="margin-bottom:10px">Próximas publicações</h2>
        <div class="list">${week.map((p) => `
          <div class="list-row" data-action="edit-post" data-id="${p.id}" style="cursor:pointer">
            <div style="width:74px" class="small"><b>${esc(relativeLabel(p.publishAt.slice(0, 10)))}</b><br>${esc(p.publishAt.slice(11))}</div>
            <div class="grow"><div class="title">${esc(p.title)}</div><div class="small muted">${esc(FORMATS.find((f) => f.id === p.format)?.label)} · ${esc(STAGES.find((s) => s.id === p.stage)?.label)}</div></div>
          </div>`).join("")}</div>
      </div>` : ""}
    <div class="section">
      <h2 style="margin-bottom:10px">Funil de produção</h2>
      <div class="kanban">
        ${STAGES.map((s, si) => {
          const list = posts.filter((p) => p.stage === s.id).sort((a, b) => (a.publishAt || "9").localeCompare(b.publishAt || "9"));
          const shown = s.id === "postado" ? list.sort((a, b) => (b.postedAt || "").localeCompare(a.postedAt || "")).slice(0, 12) : list;
          return `
            <div class="column">
              <h3><span>${s.label}</span><span>${list.length}</span></h3>
              ${shown.map((p) => `
                <div class="post-card">
                  <div class="row"><span class="chip area-conteudo">${esc(FORMATS.find((f) => f.id === p.format)?.label)}</span>${p.publishAt ? `<span class="small muted">${esc(shortDate(p.publishAt.slice(0, 10)))} ${esc(p.publishAt.slice(11))}</span>` : ""}</div>
                  <div class="title" data-action="edit-post" data-id="${p.id}" style="cursor:pointer">${esc(p.title)}</div>
                  <div class="spread">
                    <button class="btn sm ghost" data-action="post-stage" data-id="${p.id}" data-stage="${STAGES[si - 1]?.id || ""}" ${si === 0 ? "disabled" : ""} aria-label="Voltar etapa">‹</button>
                    <button class="btn sm ghost" data-action="edit-post" data-id="${p.id}">Abrir</button>
                    <button class="btn sm ghost" data-action="post-stage" data-id="${p.id}" data-stage="${STAGES[si + 1]?.id || ""}" ${si === STAGES.length - 1 ? "disabled" : ""} aria-label="Avançar etapa">›</button>
                  </div>
                </div>`).join("") || '<div class="small muted" style="padding:4px">Vazio</div>'}
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// HÁBITOS
// ---------------------------------------------------------------------------

async function renderHabitos() {
  await refreshState();
  const { habits, checkins } = state.data;
  const t = todayStr();
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  $view.innerHTML = `
    <div class="spread">
      <h1>Hábitos</h1>
      <button class="btn primary" data-action="new-habit">+ Hábito</button>
    </div>
    <p class="muted">Pequenas ações diárias. A sequência 🔥 conta só os dias em que o hábito está programado.</p>
    <div class="stack" style="margin-top:12px">
      ${habits.length ? habits.map((h) => `
        <div class="card">
          <div class="spread">
            <div data-action="edit-habit" data-id="${h.id}" style="cursor:pointer;min-width:0">
              <div class="title" style="font-weight:700">${esc(h.title)}</div>
              <div class="row small muted" style="margin-top:4px">${areaChip(h.area)}<span>${esc(daysLabel(h.days))}</span></div>
            </div>
            <span class="streak" style="font-size:1.1rem">🔥 ${h.streak}</span>
          </div>
          <div class="habit-grid" role="group" aria-label="Últimos 7 dias">
            ${last7.map((d) => {
              const on = Boolean(checkins[h.id]?.[d]);
              const scheduled = h.days.includes(weekday(d));
              return `<button class="habit-day ${on ? "on" : ""} ${scheduled ? "" : "off"}" data-action="habit-check" data-id="${h.id}" data-date="${d}" data-checked="${on}" aria-pressed="${on}" title="${esc(longDate(d))}">${DAY_LETTER[weekday(d)]}<br>${d.slice(8)}</button>`;
            }).join("")}
          </div>
        </div>`).join("") : `
        <div class="empty">
          Nenhum hábito ainda. Ideias: <b>beber 2 L de água</b>, <b>30 min sem celular antes de dormir</b>, <b>ler 10 páginas</b>, <b>postar 1 story por dia</b>.
        </div>`}
    </div>`;
}

// ---------------------------------------------------------------------------
// REVISÃO + RELATÓRIO SEMANAL
// ---------------------------------------------------------------------------

async function renderRevisao() {
  state.reviewDate ||= todayStr();
  const date = state.reviewDate;
  const [day, report] = await Promise.all([api(`/api/day?date=${date}`), api(`/api/report?end=${date}`)]);
  const done = day.items.filter((i) => i.kind !== "event" && i.status === "done");
  const pending = day.items.filter((i) => i.kind !== "event" && i.status !== "done");
  const r = day.review || {};
  const top3 = r.top3 || [];
  $view.innerHTML = `
    <div class="spread">
      <h1>Revisão</h1>
      <input type="date" id="review-date" value="${date}" max="${todayStr()}" style="width:auto" aria-label="Data da revisão">
    </div>
    <div class="grid-2" style="margin-top:12px">
      <form class="card stack" id="review-form">
        <h2>Fechar o dia · ${esc(relativeLabel(date))}</h2>
        <div class="small">
          <div><b>Feito (${done.length})</b>: ${done.length ? done.map((i) => esc(i.title)).join(" · ") : '<span class="muted">nada marcado</span>'}</div>
          <div style="margin-top:6px"><b>Ficou pendente (${pending.length})</b>: ${pending.length ? pending.map((i) => esc(i.title)).join(" · ") : '<span class="muted">nada 🎉</span>'}</div>
        </div>
        <label class="field">O que deu certo hoje?
          <textarea name="wins" placeholder="Ex.: fiz o bloco de prospecção sem abrir o Instagram">${esc(r.wins)}</textarea>
        </label>
        <label class="field">O que me travou ou eu empurrei, e por quê?
          <textarea name="blockers" placeholder="Ex.: deixei a edição para depois porque não sabia por onde começar">${esc(r.blockers)}</textarea>
        </label>
        <div class="field"><span>Energia do dia</span>
          <div class="seg" role="group" aria-label="Energia">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-action="seg" data-name="energy" data-value="${n}" aria-pressed="${(r.energy || 3) === n}">${["😫", "😕", "😐", "🙂", "🤩"][n - 1]}</button>`).join("")}</div>
          <input type="hidden" name="energy" value="${r.energy || 3}">
        </div>
        <div class="field"><span>Top 3 de amanhã (comece pela mais difícil)</span>
          ${[0, 1, 2].map((i) => `<input type="text" name="top${i}" value="${esc(top3[i] || "")}" placeholder="${i + 1}." aria-label="Prioridade ${i + 1}">`).join("")}
        </div>
        <label class="toggle"><input type="checkbox" name="createTasks" checked> Criar como tarefas para amanhã</label>
        <button class="btn primary" type="submit">${day.review ? "Atualizar revisão" : "Salvar revisão"}</button>
      </form>
      ${reportHtml(report)}
    </div>`;

  document.getElementById("review-date").addEventListener("change", (e) => { state.reviewDate = e.target.value || todayStr(); renderRevisao(); });
  document.getElementById("review-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = event.target;
    try {
      await api(`/api/reviews/${date}`, {
        method: "PUT",
        body: { wins: f.wins.value, blockers: f.blockers.value, energy: Number(f.energy.value), top3: [f.top0.value, f.top1.value, f.top2.value], createTasks: f.createTasks.checked },
      });
      toast("Revisão salva. Bom descanso!");
      renderRevisao();
    } catch (error) { toast(error.message); }
  });
}

function reportHtml(rep) {
  const rate = rep.plannedCount ? Math.round((rep.doneCount / rep.plannedCount) * 100) : 0;
  const habitRate = rep.habitDue ? Math.round((rep.habitDone / rep.habitDue) * 100) : 0;
  const maxMin = Math.max(1, ...areas().map((a) => Math.max(rep.minutes[a.id] || 0, rep.planned[a.id] || 0)));
  const maxDay = Math.max(1, ...rep.perDay.map((d) => d.planned));
  return `
    <div class="card stack">
      <div>
        <h2>Últimos 7 dias</h2>
        <div class="small muted">${esc(shortDate(rep.start))} a ${esc(shortDate(rep.end))}</div>
      </div>
      <div class="stats">
        <div class="stat"><span class="small muted">Blocos feitos</span><b>${rate}%</b><span class="small muted">${rep.doneCount} de ${rep.plannedCount}</span></div>
        <div class="stat"><span class="small muted">Hábitos</span><b>${habitRate}%</b><span class="small muted">${rep.habitDone} de ${rep.habitDue}</span></div>
        <div class="stat"><span class="small muted">Posts publicados</span><b>${rep.posted}</b></div>
        <div class="stat"><span class="small muted">Revisões feitas</span><b>${rep.reviews}/7</b></div>
      </div>
      <div>
        <h3 style="margin-bottom:4px">Horas por trabalho</h3>
        <div class="small muted" style="margin-bottom:10px">Barra cheia = tempo concluído · contorno = tempo planejado</div>
        <div class="bars">
          ${areas().map((a) => {
            const doneMin = rep.minutes[a.id] || 0;
            const planMin = rep.planned[a.id] || 0;
            return `
              <div class="bar-row" title="${esc(a.name)}: ${duration(doneMin) || "0 min"} feitos de ${duration(planMin) || "0 min"} planejados">
                <span>${esc(a.name)}</span>
                <div class="bar">
                  <span style="width:${(planMin / maxMin) * 100}%;background:transparent;box-shadow:inset 0 0 0 1.5px var(--${a.id})"></span>
                  <span style="width:${(doneMin / maxMin) * 100}%;background:var(--${a.id})"></span>
                </div>
                <span class="small" style="text-align:right;font-variant-numeric:tabular-nums">${duration(doneMin) || "0"}<span class="muted"> / ${duration(planMin) || "0"}</span></span>
              </div>`;
          }).join("")}
        </div>
      </div>
      <div>
        <h3 style="margin-bottom:10px">Blocos concluídos por dia</h3>
        <div class="week-days" role="img" aria-label="Blocos concluídos por dia: ${rep.perDay.map((d) => `${d.label} ${d.done} de ${d.planned}`).join(", ")}">
          ${rep.perDay.map((d) => `
            <div class="col" title="${esc(d.label)} ${esc(shortDate(d.date))}: ${d.done} de ${d.planned} feitos">
              <span class="small" style="color:var(--text);font-variant-numeric:tabular-nums">${d.done}</span>
              <span class="fill" style="height:${(d.done / maxDay) * 70}%"></span>
              <span>${esc(d.label)}</span>
            </div>`).join("")}
        </div>
      </div>
      ${rep.skipped ? `<div class="small muted">Você pulou ${rep.skipped} bloco(s) na semana. Se for sempre o mesmo, talvez o horário não seja realista: ajuste a rotina em vez de se culpar.</div>` : ""}
    </div>`;
}

// ---------------------------------------------------------------------------
// AJUSTES
// ---------------------------------------------------------------------------

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  state.swReg ||= await navigator.serviceWorker.getRegistration();
  return Boolean(await state.swReg?.pushManager.getSubscription());
}

async function renderAjustes() {
  await refreshState();
  const { settings: s, google: g, push } = state.data;
  const on = await pushEnabled();
  let pushHelp = "";
  if (!pushSupported()) {
    pushHelp = isIos() && !isStandalone()
      ? '<div class="notice warn"><b>No iPhone:</b> abra este site no <b>Safari</b>, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>, e abra o app pelo ícone. Aí o botão de ativar alertas aparece aqui (iOS 16.4 ou mais novo).</div>'
      : '<div class="notice warn">Este navegador não suporta notificações push.</div>';
  } else if (Notification.permission === "denied") {
    pushHelp = '<div class="notice error">As notificações foram bloqueadas. Libere nas configurações do navegador/iPhone (Ajustes → Notificações → Rotina) e volte aqui.</div>';
  }
  $view.innerHTML = `
    <h1>Ajustes</h1>
    <div class="stack" style="margin-top:12px">
      <div class="card stack">
        <h2>Notificações</h2>
        <p class="muted small" style="margin:0">Alerta antes de cada bloco, na hora de começar, plano da manhã e lembrete da revisão. Ative em cada aparelho (celular e computador).</p>
        ${pushHelp}
        <div class="row">
          ${pushSupported() && Notification.permission !== "denied" ? (on ? '<span class="chip area-pessoal">Ativas neste aparelho</span><button class="btn sm" data-action="push-off">Desativar aqui</button>' : '<button class="btn primary" data-action="push-on">Ativar notificações</button>') : ""}
          <button class="btn sm" data-action="push-test" ${push.devices ? "" : "disabled"}>Enviar teste</button>
          <span class="small muted">${push.devices} aparelho(s) cadastrados</span>
        </div>
      </div>

      <div class="card stack">
        <h2>Google Agenda</h2>
        ${!g.configured ? '<div class="notice warn">O servidor ainda não tem GOOGLE_CLIENT_ID/SECRET configurados. Veja o README.</div>' : g.connected ? `
          <div class="row"><span class="chip area-pessoal">Conectado</span><span class="small">${esc(g.email)}</span></div>
          <p class="muted small" style="margin:0">Suas rotinas, tarefas com data e posts agendados viram eventos. Seus compromissos do Agenda aparecem em "Hoje" e também geram alertas.</p>
          <div class="row">
            <button class="btn" data-action="gsync">Sincronizar tudo agora</button>
            <a class="btn" href="/auth/google">Reconectar</a>
            <button class="btn danger" data-action="gdisconnect">Desconectar</button>
          </div>` : `
          ${g.error ? `<div class="notice error">${esc(g.error)}</div>` : ""}
          <a class="btn primary" href="/auth/google">Conectar Google Agenda</a>`}
      </div>

      <form class="card stack" id="settings-form">
        <h2>Preferências</h2>
        <div class="form-grid">
          <label class="field">Lembrete padrão
            <select name="defaultReminder">${[0, 5, 10, 15, 30].map((n) => `<option value="${n}" ${s.defaultReminder === n ? "selected" : ""}>${n ? `${n} min antes` : "Só na hora"}</option>`).join("")}</select>
          </label>
          <label class="field">Fuso horário
            <input type="text" name="timezone" value="${esc(s.timezone)}">
          </label>
          <label class="field">Plano da manhã
            <input type="time" name="morningTime" value="${esc(s.morningTime)}">
          </label>
          <label class="field">Lembrete da revisão
            <input type="time" name="reviewTime" value="${esc(s.reviewTime)}">
          </label>
          <label class="field full">Agenda do Google usada
            <input type="text" name="calendarId" value="${esc(s.calendarId)}" placeholder="primary">
            <span class="small muted" style="font-weight:400">"primary" = sua agenda principal. Para usar outra, cole o ID dela (Configurações da agenda → Integrar agenda).</span>
          </label>
        </div>
        <label class="toggle"><input type="checkbox" name="notifyCalendarEvents" ${s.notifyCalendarEvents ? "checked" : ""}> Alertar também sobre compromissos do Google Agenda</label>
        <label class="toggle"><input type="checkbox" name="gcalReminders" ${s.gcalReminders ? "checked" : ""}> Criar lembretes do próprio Google Agenda nos eventos do app (reserva, pode duplicar alertas)</label>
        <button class="btn primary" type="submit">Salvar preferências</button>
      </form>

      <div class="card spread">
        <div><h2>Sessão</h2><span class="small muted">Sair deste aparelho.</span></div>
        <button class="btn danger" data-action="logout">Sair</button>
      </div>
    </div>`;

  document.getElementById("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = event.target;
    try {
      await api("/api/settings", {
        method: "PUT",
        body: {
          defaultReminder: Number(f.defaultReminder.value),
          timezone: f.timezone.value.trim(),
          morningTime: f.morningTime.value,
          reviewTime: f.reviewTime.value,
          calendarId: f.calendarId.value.trim(),
          notifyCalendarEvents: f.notifyCalendarEvents.checked,
          gcalReminders: f.gcalReminders.checked,
        },
      });
      toast("Preferências salvas");
    } catch (error) { toast(error.message); }
  });
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  if (!state.swReg) state.swReg = await navigator.serviceWorker.register("/sw.js");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permissão de notificação negada.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = state.data.push.publicKey;
  if (sub && sub.options?.applicationServerKey) {
    const current = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (current !== key) { await sub.unsubscribe(); sub = null; }
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  await api("/api/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
}

// ---------------------------------------------------------------------------
// Formulários (folha modal)
// ---------------------------------------------------------------------------

function openSheet(html, onSubmit) {
  $sheet.innerHTML = html;
  const form = $sheet.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await onSubmit(form);
      $sheet.close();
      render();
    } catch (error) {
      toast(error.message);
    } finally {
      btn.disabled = false;
    }
  });
  $sheet.showModal();
  form.querySelector("input[type=text]")?.focus();
}

const areaSeg = (value) => `
  <div class="field"><span>Área</span>
    <div class="seg" role="group" aria-label="Área">${areas().map((a) => `<button type="button" data-action="seg" data-name="area" data-value="${a.id}" aria-pressed="${value === a.id}">${esc(a.name)}</button>`).join("")}</div>
    <input type="hidden" name="area" value="${esc(value)}">
  </div>`;
const reminderSelect = (value) => `
  <label class="field">Alerta
    <select name="reminder">${REMINDERS.map((r) => `<option value="${r.v}" ${String(value ?? "") === r.v ? "selected" : ""}>${r.label}</option>`).join("")}</select>
  </label>`;
const sheetHead = (title) => `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-action="close-sheet" aria-label="Fechar">${icon('<path d="M6 6l12 12M18 6 6 18"/>')}</button></div>`;
const sheetFoot = (canDelete, kind, id) => `
  <div class="sheet-foot">
    ${canDelete ? `<button type="button" class="btn danger" data-action="delete" data-kind="${kind}" data-id="${id}">Excluir</button>` : ""}
    <div class="row"><button type="button" class="btn" data-action="close-sheet">Cancelar</button><button type="submit" class="btn primary">Salvar</button></div>
  </div>`;
const reminderValue = (v) => (v === "" ? null : Number(v));

function routineSheet(routine) {
  const r = routine || { title: "", area: "sdr", days: [1, 2, 3, 4, 5], start: "09:00", duration: 60, reminder: null, notes: "", active: true, gcal: true };
  const title = routine?.id ? "Editar rotina" : "Nova rotina";
  openSheet(`
    <form>
      ${sheetHead(title)}
      <label class="field">O que é
        <input type="text" name="title" value="${esc(r.title)}" required maxlength="120" placeholder="Ex.: Bloco de prospecção">
      </label>
      ${areaSeg(r.area)}
      <div class="field"><span>Dias</span>
        <div class="days-picker" role="group" aria-label="Dias da semana">${DAY_SHORT.map((d, i) => `<button type="button" data-action="toggle-day" data-day="${i}" aria-pressed="${r.days.includes(i)}">${d}</button>`).join("")}</div>
        <div class="row" style="margin-top:4px">
          <button type="button" class="btn sm ghost" data-action="days-preset" data-days="1,2,3,4,5">Seg–Sex</button>
          <button type="button" class="btn sm ghost" data-action="days-preset" data-days="0,1,2,3,4,5,6">Todos</button>
          <button type="button" class="btn sm ghost" data-action="days-preset" data-days="0,6">Fim de semana</button>
        </div>
        <input type="hidden" name="days" value="${r.days.join(",")}">
      </div>
      <div class="form-grid">
        <label class="field">Início<input type="time" name="start" value="${esc(r.start)}" required></label>
        <label class="field">Duração (min)<input type="number" name="duration" value="${r.duration}" min="5" max="720" step="5"></label>
        ${reminderSelect(r.reminder)}
      </div>
      <label class="field">Notas / como começar
        <textarea name="notes" placeholder="Qual é o primeiro passo pequeno?">${esc(r.notes)}</textarea>
      </label>
      <label class="toggle"><input type="checkbox" name="active" ${r.active ? "checked" : ""}> Ativa</label>
      <label class="toggle"><input type="checkbox" name="gcal" ${r.gcal !== false ? "checked" : ""}> Mostrar no Google Agenda</label>
      ${sheetFoot(Boolean(routine?.id), "routines", routine?.id)}
    </form>`, async (f) => {
    const body = {
      title: f.title.value, area: f.area.value,
      days: f.days.value ? f.days.value.split(",").map(Number) : [],
      start: f.start.value, duration: Number(f.duration.value), reminder: reminderValue(f.reminder.value),
      notes: f.notes.value, active: f.active.checked, gcal: f.gcal.checked,
    };
    if (routine?.id) await api(`/api/routines/${routine.id}`, { method: "PUT", body });
    else await api("/api/routines", { method: "POST", body });
    toast("Rotina salva");
  });
}

function taskSheet(task, defaults = {}) {
  const t = task || { title: "", area: "pessoal", date: defaults.date || todayStr(), start: "", duration: 30, reminder: null, notes: "", priority: false, gcal: true, done: false };
  openSheet(`
    <form>
      ${sheetHead(task?.id ? "Editar tarefa" : "Nova tarefa")}
      <label class="field">Tarefa
        <input type="text" name="title" value="${esc(t.title)}" required maxlength="160" placeholder="Ex.: Mandar proposta para lead X">
      </label>
      ${areaSeg(t.area)}
      <div class="form-grid">
        <label class="field">Data<input type="date" name="date" value="${esc(t.date)}"></label>
        <label class="field">Horário (opcional)<input type="time" name="start" value="${esc(t.start)}"></label>
        <label class="field">Duração (min)<input type="number" name="duration" value="${t.duration}" min="5" max="720" step="5"></label>
        ${reminderSelect(t.reminder)}
      </div>
      <label class="field">Notas<textarea name="notes">${esc(t.notes)}</textarea></label>
      <label class="toggle"><input type="checkbox" name="priority" ${t.priority ? "checked" : ""}> ⭐ Prioridade</label>
      <label class="toggle"><input type="checkbox" name="gcal" ${t.gcal !== false ? "checked" : ""}> Mostrar no Google Agenda</label>
      ${task?.id ? `<label class="toggle"><input type="checkbox" name="done" ${t.done ? "checked" : ""}> Concluída</label>` : ""}
      ${sheetFoot(Boolean(task?.id), "tasks", task?.id)}
    </form>`, async (f) => {
    const body = {
      title: f.title.value, area: f.area.value, date: f.date.value, start: f.start.value,
      duration: Number(f.duration.value), reminder: reminderValue(f.reminder.value), notes: f.notes.value,
      priority: f.priority.checked, gcal: f.gcal.checked, done: f.done ? f.done.checked : false,
    };
    if (task?.id) await api(`/api/tasks/${task.id}`, { method: "PUT", body });
    else await api("/api/tasks", { method: "POST", body });
    toast("Tarefa salva");
  });
}

function postSheet(post) {
  const p = post || { title: "", format: "reels", stage: "ideia", publishAt: "", reminder: null, caption: "", notes: "", gcal: true };
  openSheet(`
    <form>
      ${sheetHead(post?.id ? "Editar conteúdo" : "Nova ideia de conteúdo")}
      <label class="field">Tema / gancho
        <input type="text" name="title" value="${esc(p.title)}" required maxlength="160" placeholder="Ex.: 3 erros que eu cometia como SDR">
      </label>
      <div class="field"><span>Formato</span>
        <div class="seg" role="group" aria-label="Formato">${FORMATS.map((x) => `<button type="button" data-action="seg" data-name="format" data-value="${x.id}" aria-pressed="${p.format === x.id}">${x.label}</button>`).join("")}</div>
        <input type="hidden" name="format" value="${esc(p.format)}">
      </div>
      <div class="form-grid">
        <label class="field">Etapa
          <select name="stage">${STAGES.map((s) => `<option value="${s.id}" ${p.stage === s.id ? "selected" : ""}>${s.label}</option>`).join("")}</select>
        </label>
        ${reminderSelect(p.reminder)}
        <label class="field full">Publicar em
          <input type="datetime-local" name="publishAt" value="${esc(p.publishAt)}">
        </label>
      </div>
      <label class="field">Roteiro / notas<textarea name="notes" placeholder="Gancho, pontos principais, CTA…">${esc(p.notes)}</textarea></label>
      <label class="field">Legenda<textarea name="caption">${esc(p.caption)}</textarea></label>
      <label class="toggle"><input type="checkbox" name="gcal" ${p.gcal !== false ? "checked" : ""}> Mostrar no Google Agenda (se tiver data)</label>
      ${sheetFoot(Boolean(post?.id), "posts", post?.id)}
    </form>`, async (f) => {
    const body = { title: f.title.value, format: f.format.value, stage: f.stage.value, publishAt: f.publishAt.value, reminder: reminderValue(f.reminder.value), notes: f.notes.value, caption: f.caption.value, gcal: f.gcal.checked };
    if (post?.id) await api(`/api/posts/${post.id}`, { method: "PUT", body });
    else await api("/api/posts", { method: "POST", body });
    toast("Conteúdo salvo");
  });
}

function habitSheet(habit) {
  const h = habit || { title: "", area: "pessoal", days: [0, 1, 2, 3, 4, 5, 6] };
  openSheet(`
    <form>
      ${sheetHead(habit?.id ? "Editar hábito" : "Novo hábito")}
      <label class="field">Hábito
        <input type="text" name="title" value="${esc(h.title)}" required maxlength="120" placeholder="Ex.: 1 story por dia">
      </label>
      ${areaSeg(h.area)}
      <div class="field"><span>Dias</span>
        <div class="days-picker" role="group" aria-label="Dias da semana">${DAY_SHORT.map((d, i) => `<button type="button" data-action="toggle-day" data-day="${i}" aria-pressed="${h.days.includes(i)}">${d}</button>`).join("")}</div>
        <input type="hidden" name="days" value="${h.days.join(",")}">
      </div>
      ${sheetFoot(Boolean(habit?.id), "habits", habit?.id)}
    </form>`, async (f) => {
    const body = { title: f.title.value, area: f.area.value, days: f.days.value ? f.days.value.split(",").map(Number) : [] };
    if (habit?.id) await api(`/api/habits/${habit.id}`, { method: "PUT", body });
    else await api("/api/habits", { method: "POST", body });
    toast("Hábito salvo");
  });
}

// ---------------------------------------------------------------------------
// Ações (delegação de eventos)
// ---------------------------------------------------------------------------

async function findItem(collection, id) {
  if (!state.data) await refreshState();
  let item = state.data[collection].find((x) => x.id === id);
  if (!item) { await refreshState(); item = state.data[collection].find((x) => x.id === id); }
  return item;
}

document.addEventListener("click", async (event) => {
  const goEl = event.target.closest("[data-go]");
  if (goEl) { event.preventDefault(); go(goEl.dataset.go); return; }
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const { action, id } = el.dataset;
  try {
    switch (action) {
      case "day-prev": state.date = addDays(state.date, -1); return renderHoje();
      case "day-next": state.date = addDays(state.date, 1); return renderHoje();
      case "day-today": state.date = todayStr(); return renderHoje();
      case "filter": state.filter = el.dataset.area; return renderHoje();
      case "complete":
        await api("/api/complete", { method: "POST", body: { key: el.dataset.key, status: el.dataset.status } });
        if (el.dataset.status === "done") toast("Feito! 💪");
        return render();
      case "task-today": {
        const task = await findItem("tasks", id);
        await api(`/api/tasks/${id}`, { method: "PUT", body: { ...task, date: todayStr() } });
        toast("Movida para hoje");
        return render();
      }
      case "overdue-all":
        for (const t of state.day.overdue) await api(`/api/tasks/${t.id}`, { method: "PUT", body: { ...t, date: todayStr() } });
        toast("Tudo trazido para hoje. Escolha a primeira!");
        return render();
      case "habit-check": {
        const checked = el.dataset.checked !== "true";
        await api("/api/checkins", { method: "POST", body: { habitId: id, date: el.dataset.date || state.date || todayStr(), checked } });
        return render();
      }
      case "new-routine": return routineSheet(null);
      case "new-task": return taskSheet(null, { date: el.dataset.date || (state.view === "hoje" ? state.date : todayStr()) });
      case "new-post": return postSheet(null);
      case "new-habit": return habitSheet(null);
      case "edit-routine": return routineSheet(await findItem("routines", id));
      case "edit-task": return taskSheet(await findItem("tasks", id));
      case "edit-post": return postSheet(await findItem("posts", id));
      case "edit-habit": return habitSheet(await findItem("habits", id));
      case "use-template": {
        const tp = TEMPLATES[Number(el.dataset.index)];
        return routineSheet({ ...tp, reminder: null, active: true, gcal: true });
      }
      case "post-stage": {
        if (!el.dataset.stage) return;
        const post = await findItem("posts", id);
        await api(`/api/posts/${id}`, { method: "PUT", body: { ...post, stage: el.dataset.stage } });
        if (el.dataset.stage === "postado") toast("Publicado! 🎉");
        return render();
      }
      case "close-sheet": return $sheet.close();
      case "seg": {
        const group = el.parentElement;
        group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
        el.closest(".field").querySelector(`input[name="${el.dataset.name}"]`).value = el.dataset.value;
        return;
      }
      case "toggle-day":
      case "days-preset": {
        const field = el.closest(".field");
        const hidden = field.querySelector('input[name="days"]');
        let selected = hidden.value ? hidden.value.split(",").map(Number) : [];
        if (action === "toggle-day") {
          const d = Number(el.dataset.day);
          selected = selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d];
        } else {
          selected = el.dataset.days.split(",").map(Number);
        }
        hidden.value = selected.sort().join(",");
        field.querySelectorAll("[data-day]").forEach((b) => b.setAttribute("aria-pressed", String(selected.includes(Number(b.dataset.day)))));
        return;
      }
      case "delete":
        if (!confirm("Excluir? Isso também remove o evento do Google Agenda.")) return;
        await api(`/api/${el.dataset.kind}/${id}`, { method: "DELETE" });
        $sheet.close();
        toast("Excluído");
        return render();
      case "push-on":
        await enablePush();
        toast("Notificações ativadas neste aparelho");
        return render();
      case "push-off": {
        const sub = await state.swReg?.pushManager.getSubscription();
        if (sub) {
          await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
          await sub.unsubscribe();
        }
        toast("Notificações desativadas aqui");
        return render();
      }
      case "push-test": {
        const { delivered } = await api("/api/push/test", { method: "POST" });
        toast(delivered ? "Teste enviado" : "Nenhum aparelho recebeu. Reative as notificações.");
        return;
      }
      case "gsync": {
        el.disabled = true;
        const res = await api("/api/google/sync", { method: "POST" });
        toast(res.ok ? "Google Agenda sincronizado" : `Alguns itens falharam: ${res.errors[0]}`);
        return render();
      }
      case "gdisconnect":
        if (!confirm("Desconectar o Google Agenda? Os eventos já criados continuam lá.")) return;
        await api("/api/google/disconnect", { method: "POST" });
        return render();
      case "logout":
        await api("/api/logout", { method: "POST" });
        location.href = "/";
        return;
      default:
    }
  } catch (error) {
    if (error.message !== "Faça login.") toast(error.message);
  }
});

$sheet.addEventListener("click", (event) => { if (event.target === $sheet) $sheet.close(); });

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

function applyUrl() {
  const params = new URLSearchParams(location.search);
  const date = params.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) state.date = date;
  const hash = location.hash.slice(1);
  if (hash && [...TABS.map((t) => t.id), "ajustes"].includes(hash)) state.view = hash;
}

async function start() {
  applyUrl();
  const me = await (await fetch("/api/me")).json();
  if (!me.authed) return renderLogin(me);
  if (location.search.includes("erro=")) history.replaceState(null, "", `/${location.hash}`);
  await refreshState();
  await render();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => { state.swReg = reg; }).catch(() => {});
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "navigate") {
      history.replaceState(null, "", event.data.url);
      state.date = null;
      applyUrl();
      render();
    }
  });
}

window.addEventListener("hashchange", () => { applyUrl(); render(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.data && ["hoje", "revisao"].includes(state.view)) render();
});
setInterval(() => { if (document.visibilityState === "visible" && state.view === "hoje" && !$sheet.open) renderHoje().catch(() => {}); }, 60_000);

start().catch((error) => { $view.innerHTML = `<div class="notice error">${esc(error.message)}</div>`; });
