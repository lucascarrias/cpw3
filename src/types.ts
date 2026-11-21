export interface Session {
  id: string;
  title: string;
  desc: string;
  start: string;
  end: string;
  room: string;
  category: string;
  categories: string[];
  speakerIds: string[];
}

export interface Speaker {
  id: string;
  name: string;
  bio: string;
  photo: string;
  role: string;
}

export interface DayInfo {
  date: string;
  label: string;
}

export interface ScheduleMeta {
  event: string;
  source: string;
  sourcePage: string;
  timeZone: string;
  generatedAt: string;
  days: DayInfo[];
  categories: string[];
  sessionCount: number;
  speakerCount: number;
}

export interface ScheduleData {
  meta: ScheduleMeta;
  sessions: Session[];
  speakers: Speaker[];
}

export interface PlacedSession {
  session: Session;
  column: number;
  columns: number;
  top: number;
  height: number;
}
