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
const FAVORITES_KEY = 'cpw-piaui3-favorites';
const favorites = new Set<string>();

function loadFavorites(): void {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return;
    const ids: unknown = JSON.parse(raw);
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (typeof id === 'string' && sessionMap.has(id)) favorites.add(id);
    }
  } catch {
    // Storage can be unavailable or hold junk from older versions; start clean.
  }
}

function saveFavorites(): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    // Private mode / quota: favorites keep working for this session only.
  }
}

function isFavorite(id: string): boolean {
  return favorites.has(id);
}

function starIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>`;
}

function syncFavoriteButtons(id: string): void {
  const active = isFavorite(id);
  document.querySelectorAll<HTMLElement>(`[data-fav="${CSS.escape(id)}"]`).forEach((button) => {
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('is-on', active);
    const label = button.querySelector<HTMLElement>('[data-fav-label]');
    if (label) label.textContent = active ? 'Nos favoritos' : 'Favoritar';
    button.setAttribute(
      'aria-label',
      active ? 'Remover dos favoritos' : 'Adicionar aos favoritos',
    );
  });
  document.querySelectorAll<HTMLElement>(`[data-session="${CSS.escape(id)}"]`).forEach((card) => {
    card.classList.toggle('is-favorite', active);
  });
}

function toggleFavorite(id: string): void {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveFavorites();
  syncFavoriteButtons(id);
  updateBadges();
  if (activeView === 'favoritos') renderFavorites();
}

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

function dateRangeLabel(): string {
  const days = data.meta.days;
  if (!days.length) return '';
  const first = shortDayLabel(days[0].date);
  const last = shortDayLabel(days[days.length - 1].date);
  if (first.month === last.month) {
    return first.day === last.day
      ? `${first.day} ${first.month}`
      : `${first.day}–${last.day} ${first.month}`;
  }
  return `${first.day} ${first.month} – ${last.day} ${last.month}`;
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
          <span class="brand-dates">${esc(dateRangeLabel())}</span>
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
  if (view === activeView) return;
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  const favBadge = document.querySelector<HTMLElement>('[data-fav-badge]');
  if (favBadge) {
    favBadge.hidden = favorites.size === 0;
    favBadge.textContent = String(favorites.size);
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

interface CardMetrics {
  compact: boolean;
  tall: boolean;
  /** Wide columns fit the full time range and room on one line. */
  wide: boolean;
  /** Title lines that fit in the card's vertical space. */
  lines: number;
  /** Title font size in px, chosen from the available height. */
  titlePx: number;
}

/**
 * Derives readable typography from the card height. The vertical budget is the
 * card height minus borders, padding, the time/room line(s) and their gaps, so
 * the clamped title always uses the space that is actually left. Must stay in
 * sync with the paddings/line-height used for `.session-card` in styles.css.
 */
function cardMetrics(height: number, columnWidth: number): CardMetrics {
  const compact = height < 70;
  const tall = height >= 112;
  const wide = columnWidth >= 140;
  const paddingY = compact ? 6 : tall ? 12 : 10;
  // Tall narrow cards give the room its own line, so reserve two meta lines.
  const metaHeight = (compact ? 9.5 : tall ? 10.5 : 10) + (tall && !wide ? 11 : 0);
  const gap = compact ? 0 : 1;
  const titlePx = tall ? 12.5 : compact ? 10.5 : 11.5;
  const lineHeight = titlePx * 1.16;
  const titleSpace = height - 2 - paddingY - metaHeight - gap;
  const maxLines = tall ? 8 : 6;
  const lines = Math.max(1, Math.min(maxLines, Math.floor(titleSpace / lineHeight)));
  return { compact, tall, wide, lines, titlePx };
}

function renderCard(placed: PlacedSession, columnWidth: number): string {
  const { session, column, top, height } = placed;
  const category = session.categories[0] ?? '';
  const color = categoryColor(category);
  const isLong = durationMinutes(session.start, session.end) >= 240;
  const fav = isFavorite(session.id);
  const metrics = cardMetrics(height, columnWidth);
  // Narrow columns get the tighter time label so it leaves room for the star.
  const timeLabel = metrics.wide
    ? `${formatTime(session.start)} – ${formatTime(session.end)}`
    : `${formatTime(session.start)}–${formatTime(session.end)}`;
  return `
    <div class="session-card${metrics.compact ? ' compact' : ''}${metrics.tall ? ' tall' : ''}${metrics.wide ? ' wide' : ' narrow'}${isLong ? ' long-session' : ''}${fav ? ' is-favorite' : ''}" role="button" tabindex="0" style="--cat:${color};--title-lines:${metrics.lines};--title-size:${metrics.titlePx}px;top:${top}px;height:${height}px;left:${column * columnWidth + 2}px;width:${columnWidth - 4}px" data-session="${esc(session.id)}" aria-label="${esc(session.title)}, ${formatTime(session.start)}">
      <span class="card-meta">
        <span class="card-time">${timeLabel}</span>
        <span class="card-room">${esc(session.room)}</span>
      </span>
      <span class="card-title">${esc(session.title)}</span>
      ${isLong ? '<span class="card-continuous">Ativação contínua</span>' : ''}
      <button class="star-btn" data-fav="${esc(session.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">
        ${starIcon()}
      </button>
    </div>`;
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

function favoriteSessions(): Session[] {
  return data.sessions
    .filter((session) => favorites.has(session.id))
    .sort((a, b) => a.start.localeCompare(b.start));
}

function overlapWarnings(sessions: Session[]): string {
  const conflicts: string[] = [];
  for (let i = 0; i < sessions.length; i += 1) {
    for (let j = i + 1; j < sessions.length; j += 1) {
      const a = sessions[i];
      const b = sessions[j];
      if (new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end)) {
        conflicts.push(`
          <li>
            <strong>${formatTime(a.start)}–${formatTime(a.end)}</strong>
            <span>${esc(a.title)}</span>
            <span class="conflict-x">×</span>
            <span>${esc(b.title)}</span>
          </li>`);
      }
    }
  }
  if (!conflicts.length) return '';
  return `
    <div class="conflict-banner" role="status">
      <p class="conflict-title">⚠️ Choque de horário</p>
      <p class="conflict-sub">${conflicts.length === 1 ? 'Dois favoritos acontecem' : 'Alguns favoritos acontecem'} ao mesmo tempo:</p>
      <ul>${conflicts.join('')}</ul>
    </div>`;
}

function renderFavorites(): void {
  const view = document.querySelector<HTMLElement>('#view-favoritos');
  if (!view) return;
  const sessions = favoriteSessions();

  if (!sessions.length) {
    view.innerHTML = `
      <div class="view-head">
        <h2>Favoritos</h2>
        <span class="view-meta">0 atividades</span>
      </div>
      <div class="empty">
        <div class="empty-icon">⭐</div>
        <h3>Nenhum favorito ainda</h3>
        <p>Toque na estrela de uma atividade para montar a sua agenda pessoal. Tudo fica salvo só neste aparelho.</p>
        <button data-go-agenda>Explorar a agenda</button>
      </div>`;
    return;
  }

  const groups: string[] = [];
  const list = sessions
    .map((session) => {
      const date = session.start.slice(0, 10);
      const header = groups.includes(date)
        ? ''
        : `<h3 class="fav-day">${esc(dayLabel(date))}</h3>`;
      if (!groups.includes(date)) groups.push(date);
      const color = categoryColor(session.categories[0] ?? '');
      return `${header}
        <article class="fav-item" style="--cat:${color}">
          <button class="fav-main" data-session="${esc(session.id)}" aria-label="Ver detalhes de ${esc(session.title)}">
            <span class="fav-time">${formatTime(session.start)} – ${formatTime(session.end)}</span>
            <span class="fav-title">${esc(session.title)}</span>
            <span class="fav-room">${esc(session.room)}</span>
          </button>
          <button class="star-btn fav-star" data-fav="${esc(session.id)}" aria-pressed="true" aria-label="Remover dos favoritos">
            ${starIcon()}
          </button>
        </article>`;
    })
    .join('');

  view.innerHTML = `
    <div class="view-head">
      <h2>Favoritos</h2>
      <span class="view-meta">${sessions.length} atividade${sessions.length === 1 ? '' : 's'}</span>
    </div>
    ${overlapWarnings(sessions)}
    <div class="fav-list">${list}</div>
    <p class="fav-note">Salvos apenas neste aparelho, sem conta e sem sincronização.</p>`;
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
          <button class="fav-pill" data-fav="${esc(session.id)}" aria-pressed="${isFavorite(session.id)}">
            ${starIcon()}<span data-fav-label>${isFavorite(session.id) ? 'Nos favoritos' : 'Favoritar'}</span>
          </button>
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
  const fav = target.closest<HTMLElement>('[data-fav]');
  if (fav?.dataset.fav) {
    toggleFavorite(fav.dataset.fav);
    return;
  }
  const card = target.closest<HTMLElement>('[data-session]');
  if (card?.dataset.session) openSheet(card.dataset.session);
}

function handleCardKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.fav) return;
  const card = target.closest<HTMLElement>('[data-session]');
  if (!card?.dataset.session) return;
  event.preventDefault();
  openSheet(card.dataset.session);
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
    const chips = document.querySelector<HTMLElement>('.chips-scroll')?.offsetHeight ?? 0;
    window.scrollTo({ top: window.scrollY + rect.top - header - chips - 26, behavior: 'smooth' });
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
  loadFavorites();
  app!.addEventListener('click', handleCardClick);
  app!.addEventListener('keydown', handleCardKeydown);
  renderAgenda();
  updateBadges();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSheet();
  });
  window.addEventListener('resize', syncHeaderHeight);

  if (nowTimer) window.clearInterval(nowTimer);
  nowTimer = window.setInterval(updateNowLine, 60_000);
}

void init();

