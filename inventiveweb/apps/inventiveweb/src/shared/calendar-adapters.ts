export type TimeSlot = { start: Date; end: Date };
export type CalendarEvent = { id: string; htmlLink?: string };

export interface CalendarProviderAdapter {
  readonly provider: string;
  getFreeBusy(args: {
    accessToken: string;
    calendarId: string;
    from: Date;
    to: Date;
    timeZone: string;
  }): Promise<TimeSlot[]>;
  createEvent(args: {
    accessToken: string;
    calendarId: string;
    summary: string;
    description?: string;
    start: Date;
    end: Date;
    timeZone: string;
  }): Promise<CalendarEvent>;
  deleteEvent(args: {
    accessToken: string;
    calendarId: string;
    eventId: string;
  }): Promise<void>;
  refreshAccessToken(args: {
    refreshToken: string;
  }): Promise<{ accessToken: string; expiresAt: Date }>;
}

export class NotConfiguredAdapter implements CalendarProviderAdapter {
  readonly provider: string;
  constructor(provider: string) { this.provider = provider; }
  async getFreeBusy(): Promise<TimeSlot[]> {
    return [];
  }
  async createEvent(): Promise<CalendarEvent> {
    return { id: `mock-${this.provider.toLowerCase()}-${Date.now()}` };
  }
  async deleteEvent(): Promise<void> {
  }
  async refreshAccessToken(): Promise<{ accessToken: string; expiresAt: Date }> {
    throw new Error(`${this.provider} calendar is not configured.`);
  }
}

export const calendarAdapters: Record<string, CalendarProviderAdapter> = {
  GOOGLE: new NotConfiguredAdapter('GOOGLE'),
  MICROSOFT: new NotConfiguredAdapter('MICROSOFT'),
};

export function getCalendarAdapter(provider: string): CalendarProviderAdapter {
  return calendarAdapters[provider] ?? new NotConfiguredAdapter(provider);
}

export function registerCalendarAdapter(adapter: CalendarProviderAdapter): void {
  calendarAdapters[adapter.provider] = adapter;
}
