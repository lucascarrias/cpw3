import './styles.css';
import {
  CATEGORIES,
  categoryColor,
  dayStartMs,
  durationMinutes,
  formatTime,
  loadSchedule,
  sessionsByDay,
  shortDayLabel,
  speakersById,
} from './data';
import { PX_PER_MINUTE, layoutDay } from './timeline';
import type { PlacedSession, ScheduleData, Session, Speaker } from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

let data: ScheduleData;
let byDay = new Map<string, Session[]>();
let speakerMap = new Map<string, Speaker>();
let activeDay = '';
let activeView: 'agenda' | 'favoritos' | 'filtros' = 'agenda';
let lastRange = { startMin: 0, endMin: 0 };
let didAutoScroll = false;
let nowTimer: number | undefined;

const esc = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

function eventToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
}

function renderLoading(): void {
  app!.innerHTML = `
    <div class="boot" aria-busy="true" aria-label="Carregando programação">
      <div class="boot-bar"></div>
      <div class="boot-body">
        <div class="skeleton skeleton-line short"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
    </div>`;
}

function renderError(message: string): void {
  app!.innerHTML = `
    <div class="app">
      <header class="app-header">
        <div class="brand">
          <div class="brand-mark">CP</div>
          <div class="brand-copy">
            <p class="eyebrow">Campus Party Weekend</p>
            <h1>CPW Piauí #3</h1>
          </div>
        </div>
      </header>
      <div class="error-panel">
        <h2>Não foi possível carregar</h2>
        <p>${esc(message)}</p>
        <button class="btn-primary" id="retry">Tentar de novo</button>
      </div>
    </div>`;
  document.querySelector('#retry')?.addEventListener('click', () => {
    renderLoading();
    void init();
  });
}

function dayTabs(): string {
  return data.meta.days
    .map((day) => {
      const label = shortDayLabel(day.date);
      const active = day.date === activeDay;
      return `
        <button class="day-tab" role="tab" aria-selected="${active}" data-day="${day.date}">
          <span class="dow">${esc(label.weekday)}</span>
          <span class="dnum">${esc(label.day)} ${esc(label.month)}</span>
        </button>`;
    })
    .join('');
}

function renderShell(): void {
  app!.innerHTML = `
    <div class="app">
      <header class="app-header">
        <div class="brand">
          <div class="brand-mark">CP</div>
          <div class="brand-copy">
            <p class="eyebrow">Campus Party Weekend</p>
            <h1>CPW Piauí #3</h1>
          </div>
          <span class="brand-dates">21–22 nov</span>
        </div>
        <nav class="day-tabs" role="tablist" aria-label="Dias do evento">${dayTabs()}</nav>
      </header>
      <main class="app-main">
        <section class="view" id="view-agenda" aria-label="Agenda"></section>
        <section class="view" id="view-favoritos" aria-label="Favoritos" hidden></section>
        <section class="view" id="view-filtros" aria-label="Filtros" hidden></section>
      </main>
      <nav class="bottom-nav" aria-label="Navegação principal">
        <button class="nav-btn active" data-view="agenda" aria-current="page">
          ${icon('calendar')}<span>Agenda</span>
        </button>
        <button class="nav-btn" data-view="favoritos">
          ${icon('star')}<span>Favoritos</span>
        </button>
        <button class="nav-btn" data-view="filtros">
          ${icon('filter')}<span>Filtros</span>
        </button>
      </nav>
      <div id="sheet-root"></div>
    </div>`;

  document.querySelectorAll<HTMLButtonElement>('.day-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const next = tab.dataset.day;
      if (!next || next === activeDay) return;
      activeDay = next;
      didAutoScroll = true;
      updateDayTabs();
      renderAgenda();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view as typeof activeView));
  });
}

function updateDayTabs(): void {
  document.querySelectorAll<HTMLButtonElement>('.day-tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.day === activeDay));
  });
}

function setView(view: typeof activeView): void {
  activeView = view;
  document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((button) => {
    const isActive = button.dataset.view === view;
    button.classList.toggle('active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll<HTMLElement>('.view').forEach((section) => {
    section.hidden = section.id !== `view-${view}`;
  });
  if (view === 'agenda') renderAgenda();
}

function renderAgenda(): void {
  const view = document.querySelector<HTMLElement>('#view-agenda');
  if (!view) return;

  const sessions = byDay.get(activeDay) ?? [];
  const label = shortDayLabel(activeDay);

  if (!sessions.length) {
    view.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🗓️</div>
        <h3>Sem atividades neste dia</h3>
        <p>A programação ainda não foi divulgada para esta data.</p>
      </div>`;
    return;
  }

  const { placed, startMin, endMin, maxColumns } = layoutDay(sessions, activeDay);
  lastRange = { startMin, endMin };
  const height = Math.round((endMin - startMin) * PX_PER_MINUTE);
  const available = Math.max(280, Math.min(window.innerWidth, 480) - 28 - 46);
  const columnWidth = Math.max(104, Math.floor(available / maxColumns));
  const trackWidth = Math.max(available, columnWidth * maxColumns);
  const firstHour = Math.ceil(startMin / 60) * 60;
  const hours: number[] = [];
  for (let minute = firstHour; minute <= endMin; minute += 60) hours.push(minute);

  view.innerHTML = `
    <div class="view-head">
      <h2>${esc(label.weekday.toUpperCase())}, ${esc(label.day)} ${esc(label.month)}</h2>
      <span class="view-meta">${sessions.length} atividades</span>
    </div>
    ${
      trackWidth > available + 8
        ? '<p class="pan-hint">Deslize a timeline para o lado para ver todas as salas →</p>'
        : ''
    }
    <div class="timeline" style="height:${height}px">
      <div class="timeline-hours" aria-hidden="true">
        ${hours
          .map(
            (minute) =>
              `<span class="hour-label" style="top:${Math.round(
                (minute - startMin) * PX_PER_MINUTE,
              )}px">${String(Math.floor(minute / 60)).padStart(2, '0')}:00</span>`,
          )
          .join('')}
      </div>
      <div class="timeline-scroll">
        <div class="timeline-track" style="width:${trackWidth}px;height:${height}px">
          ${hours
            .map(
              (minute) =>
                `<span class="hour-line" style="top:${Math.round(
                  (minute - startMin) * PX_PER_MINUTE,
                )}px"></span>`,
            )
            .join('')}
          <div class="now-line" hidden><span>Agora</span></div>
          ${placed.map((item) => renderCard(item, columnWidth)).join('')}
        </div>
      </div>
    </div>`;

  updateNowLine();
  maybeAutoScroll();
}

function renderCard(placed: PlacedSession, columnWidth: number): string {
  const { session, column, top, height } = placed;
  const category = session.categories[0] ?? '';
  const color = categoryColor(category);
  const isLong = durationMinutes(session.start, session.end) >= 240;
  return `
    <button class="session-card${height < 64 ? ' compact' : ''}${isLong ? ' long-session' : ''}" style="--cat:${color};top:${top}px;height:${height}px;left:${column * columnWidth + 2}px;width:${columnWidth - 4}px" data-session="${esc(session.id)}" aria-label="${esc(session.title)}, ${formatTime(session.start)}">
      <span class="card-time">${formatTime(session.start)} – ${formatTime(session.end)}</span>
      <span class="card-title">${esc(session.title)}</span>
      <span class="card-room">${esc(session.room)}</span>
      ${isLong ? '<span class="card-continuous">Ativação contínua</span>' : ''}
    </button>`;
}

function updateNowLine(): void {
  const line = document.querySelector<HTMLElement>('.now-line');
  if (!line) return;
  if (activeView !== 'agenda' || activeDay !== eventToday()) {
    line.hidden = true;
    return;
  }
  const minutes = (Date.now() - dayStartMs(activeDay)) / 60000;
  if (minutes < lastRange.startMin || minutes > lastRange.endMin) {
    line.hidden = true;
    return;
  }
  line.hidden = false;
  line.style.top = `${Math.round((minutes - lastRange.startMin) * PX_PER_MINUTE)}px`;
}

function maybeAutoScroll(): void {
  if (didAutoScroll || activeView !== 'agenda' || activeDay !== eventToday()) return;
  didAutoScroll = true;
  const line = document.querySelector<HTMLElement>('.now-line');
  if (!line || line.hidden) return;
  requestAnimationFrame(() => {
    const rect = line.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('.app-header')?.offsetHeight ?? 140;
    window.scrollTo({ top: window.scrollY + rect.top - header - 34, behavior: 'smooth' });
  });
}

function icon(name: 'calendar' | 'star' | 'filter'): string {
  if (name === 'calendar') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>`;
  }
  if (name === 'star') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>`;
}

async function init(): Promise<void> {
  try {
    data = await loadSchedule();
  } catch (error) {
    renderError(error instanceof Error ? error.message : 'Erro desconhecido');
    return;
  }

  byDay = sessionsByDay(data.sessions);
  speakerMap = speakersById(data.speakers);
  activeDay = data.meta.days[0]?.date ?? '';
  const today = eventToday();
  if (data.meta.days.some((day) => day.date === today)) activeDay = today;

  renderShell();
  renderAgenda();

  if (nowTimer) window.clearInterval(nowTimer);
  nowTimer = window.setInterval(updateNowLine, 60_000);
}

void init();

// Referenced now and expanded in the next steps.
void CATEGORIES;
void speakerMap;
