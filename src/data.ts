import type { ScheduleData, Session, Speaker } from './types';

/** The nine official tracks of CPW Piauí #3, in display order. */
export const CATEGORIES = [
  'EMPREENDEDORISMO E STARTUPS',
  'INTELIGÊNCIA ARTIFICIAL',
  'ASTRONOMIA',
  'GAMES E E-SPORTS',
  'PROGRAMAÇÃO E HACKING',
  'TECNOLOGIA QUÂNTICA E CIBERSEGURANÇA',
  'EDUCAÇÃO E POLÍTICAS PÚBLICAS',
  'CIÊNCIA E BIOTECNOLOGIA',
  'ARTE E CULTURA GEEK',
] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  'EMPREENDEDORISMO E STARTUPS': '#f59e0b',
  'INTELIGÊNCIA ARTIFICIAL': '#60a5fa',
  ASTRONOMIA: '#a78bfa',
  'GAMES E E-SPORTS': '#f472b6',
  'PROGRAMAÇÃO E HACKING': '#34d399',
  'TECNOLOGIA QUÂNTICA E CIBERSEGURANÇA': '#22d3ee',
  'EDUCAÇÃO E POLÍTICAS PÚBLICAS': '#fb7185',
  'CIÊNCIA E BIOTECNOLOGIA': '#a3e635',
  'ARTE E CULTURA GEEK': '#fb923c',
};

export const NO_CATEGORY_COLOR = '#94a3b8';
export const NO_CATEGORY_LABEL = 'GERAL';

export function categoryColor(category: string | null | undefined): string {
  return (category && CATEGORY_COLORS[category]) || NO_CATEGORY_COLOR;
}

export function categoriesOf(session: Session): string[] {
  return session.categories.length ? session.categories : [];
}

/** Load the build-time snapshot shipped in public/. No network calls beyond our own host. */
export async function loadSchedule(): Promise<ScheduleData> {
  const response = await fetch(`${import.meta.env.BASE_URL}schedule.json`);
  if (!response.ok) {
    throw new Error(`Falha ao carregar a programação (HTTP ${response.status})`);
  }
  const data = (await response.json()) as ScheduleData;
  if (!Array.isArray(data.sessions) || !Array.isArray(data.speakers) || !data.meta) {
    throw new Error('Formato de programação inválido');
  }
  return data;
}

/** Local midnight of an ISO calendar date in the event timezone (Fortaleza, UTC-3). */
export function dayStartMs(date: string): number {
  return new Date(`${date}T00:00:00-03:00`).getTime();
}

export function minutesIntoDay(iso: string, date: string): number {
  return (new Date(iso).getTime() - dayStartMs(date)) / 60000;
}

export function sessionsByDay(sessions: Session[]): Map<string, Session[]> {
  const map = new Map<string, Session[]>();
  for (const session of sessions) {
    const date = session.start.slice(0, 10);
    const list = map.get(date);
    if (list) list.push(session);
    else map.set(date, [session]);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        b.end.localeCompare(a.end) ||
        a.title.localeCompare(b.title, 'pt-BR'),
    );
  }
  return map;
}

export function speakersById(speakers: Speaker[]): Map<string, Speaker> {
  return new Map(speakers.map((speaker) => [speaker.id, speaker]));
}

export function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function shortDayLabel(date: string): { weekday: string; day: string; month: string } {
  const parsed = new Date(`${date}T12:00:00-03:00`);
  return {
    weekday: WEEKDAYS[parsed.getUTCDay()],
    day: String(parsed.getUTCDate()).padStart(2, '0'),
    month: parsed
      .toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' })
      .replace('.', ''),
  };
}

/** Difference in minutes between two ISO timestamps. */
export function durationMinutes(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h${String(rest).padStart(2, '0')}`;
}

/** Initials for speakers without a photo. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
