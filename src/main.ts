import './styles.css';
import {
  CATEGORIES,
  categoryColor,
  dayStartMs,
  durationMinutes,
  formatDuration,
  formatTime,
  initials,
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
let sessionMap = new Map<string, Session>();
let activeDay = '';
let activeView: 'agenda' | 'favoritos' | 'filtros' = 'agenda';
let lastRange = { startMin: 0, endMin: 0 };
let didAutoScroll = false;
let nowTimer: number | undefined;
let lastFocus: HTMLElement | null = null;

const selectedCategories = new Set<string>();

const esc = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

const checkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>`;

function eventToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
}

function filteredSessions(date: string): Session[] {
  const sessions = byDay.get(date) ?? [];
  if (!selectedCategories.size) return sessions;
  return sessions.filter((session) =>
    session.categories.some((category) => selectedCategories.has(category)),
  );
}

function dayLabel(date: string): string {
  const info = data.meta.days.find((day) => day.date === date);
  return info?.label ?? date;
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
          <span class="nav-badge" data-fav-badge hidden></span>
        </button>
        <button class="nav-btn" data-view="filtros">
          ${icon('filter')}<span>Filtros</span>
          <span class="nav-badge" data-filter-badge hidden></span>
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

  syncHeaderHeight();
}

function syncHeaderHeight(): void {
  const header = document.querySelector<HTMLElement>('.app-header');
  if (header) {
    document.querySelector<HTMLElement>('.app')?.style.setProperty(
      '--header-h',
      `${header.offsetHeight}px`,
    );
  }
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
  if (view === 'filtros') renderFilters();
  if (view === 'favoritos') renderFavorites();
}

function chipsMarkup(): string {
  return CATEGORIES.map((category) => {
    const active = selectedCategories.has(category);
    return `
      <button class="chip" data-category="${esc(category)}" aria-pressed="${active}" style="--cat:${categoryColor(category)}">
        ${active ? checkIcon : ''}<span>${esc(category)}</span>
      </button>`;
  }).join('');
}

function updateBadges(): void {
  const filterBadge = document.querySelector<HTMLElement>('[data-filter-badge]');
  if (filterBadge) {
    filterBadge.hidden = selectedCategories.size === 0;
    filterBadge.textContent = String(selectedCategories.size);
  }
}

function renderAgenda(): void {
  const view = document.querySelector<HTMLElement>('#view-agenda');
  if (!view) return;

  const chipsScroll = document.querySelector<HTMLElement>('#agenda-chips')?.scrollLeft ?? 0;
  const sessions = filteredSessions(activeDay);
  const total = (byDay.get(activeDay) ?? []).length;
  const label = shortDayLabel(activeDay);

  const head = `
    <div class="chips-scroll" id="agenda-chips" role="group" aria-label="Filtrar por trilha">
      ${chipsMarkup()}
    </div>
    <div class="view-head">
      <h2>${esc(label.weekday.toUpperCase())}, ${esc(label.day)} ${esc(label.month)}</h2>
      <span class="view-meta">${selectedCategories.size ? `${sessions.length} de ${total}` : `${total}`} atividades</span>
    </div>`;

  if (!sessions.length) {
    view.innerHTML = `${head}
      <div class="empty">
        <div class="empty-icon">🔎</div>
        <h3>Nada com esses filtros</h3>
        <p>Nenhuma atividade desta data combina com as trilhas selecionadas.</p>
        ${
          selectedCategories.size
            ? '<button data-clear-filters>Limpar filtros</button>'
            : ''
        }
      </div>`;
    const chips = document.querySelector<HTMLElement>('#agenda-chips');
    if (chips) chips.scrollLeft = chipsScroll;
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

  view.innerHTML = `${head}
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

  const chips = document.querySelector<HTMLElement>('#agenda-chips');
  if (chips) chips.scrollLeft = chipsScroll;
  updateNowLine();
  updateBadges();
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

function renderFilters(): void {
  const view = document.querySelector<HTMLElement>('#view-filtros');
  if (!view) return;
  const count = selectedCategories.size
    ? data.sessions.filter((session) =>
        session.categories.some((category) => selectedCategories.has(category)),
      ).length
    : data.sessions.length;

  view.innerHTML = `
    <div class="view-head">
      <h2>Filtrar por trilha</h2>
      <span class="view-meta">${selectedCategories.size} selecionada${selectedCategories.size === 1 ? '' : 's'}</span>
    </div>
    <p class="filter-hint">Combine quantas quiser. Sem seleção, a agenda mostra tudo.</p>
    <div class="chips-wrap">${chipsMarkup()}</div>
    <div class="filter-summary">
      <strong>${count}</strong> atividade${count === 1 ? '' : 's'} na programação
    </div>
    <div class="filter-actions">
      <button class="btn-ghost" data-clear-filters ${selectedCategories.size ? '' : 'disabled'}>Limpar filtros</button>
      <button class="btn-primary" data-go-agenda>Ver agenda</button>
    </div>`;
  updateBadges();
}

// Placeholder until step 4 adds the favorites list.
function renderFavorites(): void {
  const view = document.querySelector<HTMLElement>('#view-favoritos');
  if (!view) return;
  view.innerHTML = `
    <div class="empty">
      <div class="empty-icon">⭐</div>
      <h3>Seus favoritos</h3>
      <p>Em breve você poderá salvar atividades aqui.</p>
    </div>`;
}

function toggleCategory(category: string): void {
  if (selectedCategories.has(category)) selectedCategories.delete(category);
  else selectedCategories.add(category);
  if (activeView === 'filtros') renderFilters();
  else renderAgenda();
}

function openSheet(sessionId: string): void {
  const session = sessionMap.get(sessionId);
  if (!session) return;
  const speakers = session.speakerIds
    .map((id) => speakerMap.get(id))
    .filter((speaker): speaker is Speaker => Boolean(speaker));
  const category = session.categories[0] ?? '';
  const color = categoryColor(category);
  const day = shortDayLabel(session.start.slice(0, 10));
  const root = document.querySelector<HTMLElement>('#sheet-root');
  if (!root) return;

  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  root.innerHTML = `
    <div class="sheet-layer">
      <div class="sheet-backdrop" data-close-sheet></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="sheet-grip" aria-hidden="true"></div>
        <button class="sheet-close" data-close-sheet aria-label="Fechar detalhes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
        <div class="sheet-scroll">
          <span class="sheet-category" style="--cat:${color}">${esc(category || 'GERAL')}</span>
          <h2 id="sheet-title">${esc(session.title)}</h2>
          <p class="sheet-when">
            <span>${esc(day.weekday)}, ${esc(day.day)} ${esc(day.month)}</span>
            <span class="dot">·</span>
            <span>${formatTime(session.start)} – ${formatTime(session.end)}</span>
            <span class="dot">·</span>
            <span>${formatDuration(durationMinutes(session.start, session.end))}</span>
          </p>
          <p class="sheet-room"><span class="pin" aria-hidden="true"></span>${esc(session.room)}</p>
          ${
            session.desc
              ? `<p class="sheet-desc">${esc(session.desc)}</p>`
              : '<p class="sheet-desc muted">Sem descrição.</p>'
          }
          ${
            speakers.length
              ? `<h3 class="speakers-title">Palestrantes</h3>
                <div class="speakers">
                  ${speakers
                    .map(
                      (speaker) => `
                    <article class="speaker">
                      <div class="avatar" style="background:${color}33">
                        <span>${esc(initials(speaker.name))}</span>
                        ${
                          speaker.photo
                            ? `<img src="${esc(speaker.photo)}" alt="${esc(speaker.name)}" loading="lazy" onerror="this.remove()" />`
                            : ''
                        }
                      </div>
                      <div class="speaker-copy">
                        <h4>${esc(speaker.name)}</h4>
                        ${speaker.role ? `<p class="speaker-role">${esc(speaker.role)}</p>` : ''}
                        ${
                          speaker.bio
                            ? `<p class="speaker-bio">${esc(speaker.bio)}</p>
                               ${
                                 speaker.bio.length > 180
                                   ? '<button class="bio-toggle" data-expand>Ler mais</button>'
                                   : ''
                               }`
                            : ''
                        }
                      </div>
                    </article>`,
                    )
                    .join('')}
                </div>`
              : ''
          }
          <div class="sheet-tail"></div>
        </div>
      </div>
    </div>`;

  document.body.classList.add('sheet-open');
  const layer = root.querySelector<HTMLElement>('.sheet-layer');
  requestAnimationFrame(() => layer?.classList.add('open'));
  root.querySelector<HTMLElement>('.sheet-close')?.focus();
}

function closeSheet(): void {
  const layer = document.querySelector<HTMLElement>('.sheet-layer');
  if (!layer) return;
  layer.classList.remove('open');
  document.body.classList.remove('sheet-open');
  window.setTimeout(() => {
    const root = document.querySelector<HTMLElement>('#sheet-root');
    if (root) root.innerHTML = '';
    lastFocus?.focus();
  }, 220);
}

function handleCardClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const chip = target.closest<HTMLElement>('[data-category]');
  if (chip?.dataset.category) {
    toggleCategory(chip.dataset.category);
    return;
  }
  if (target.closest('[data-clear-filters]')) {
    selectedCategories.clear();
    if (activeView === 'filtros') renderFilters();
    else renderAgenda();
    return;
  }
  if (target.closest('[data-go-agenda]')) {
    setView('agenda');
    return;
  }
  if (target.closest('[data-close-sheet]')) {
    closeSheet();
    return;
  }
  const expand = target.closest<HTMLElement>('[data-expand]');
  if (expand) {
    const speaker = expand.closest<HTMLElement>('.speaker');
    const expanded = speaker?.classList.toggle('expanded');
    expand.textContent = expanded ? 'Mostrar menos' : 'Ler mais';
    return;
  }
  const card = target.closest<HTMLElement>('[data-session]');
  if (card?.dataset.session) openSheet(card.dataset.session);
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
  sessionMap = new Map(data.sessions.map((session) => [session.id, session]));
  activeDay = data.meta.days[0]?.date ?? '';
  const today = eventToday();
  if (data.meta.days.some((day) => day.date === today)) activeDay = today;

  renderShell();
  app!.addEventListener('click', handleCardClick);
  renderAgenda();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSheet();
  });
  window.addEventListener('resize', syncHeaderHeight);

  if (nowTimer) window.clearInterval(nowTimer);
  nowTimer = window.setInterval(updateNowLine, 60_000);
}

void init();

// Kept for the next steps and to guarantee the helpers stay referenced.
void dayLabel;
void CATEGORIES;
