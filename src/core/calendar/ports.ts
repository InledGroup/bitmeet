import type { CalendarEvent, CalendarInvitation } from "./domain";

export interface ICalendarRepository {
  saveEvent(event: CalendarEvent): Promise<void>;
  getEvent(id: string): Promise<CalendarEvent | null>;
  deleteEvent(id: string): Promise<void>;
  listEvents(startTime: number, endTime: number): Promise<CalendarEvent[]>;
  
  saveInvitation(invitation: CalendarInvitation): Promise<void>;
  getInvitation(id: string): Promise<CalendarInvitation | null>;
  deleteInvitation(id: string): Promise<void>;
  listInvitations(): Promise<CalendarInvitation[]>;
  updateInvitationStatus(id: string, status: 'accepted' | 'rejected'): Promise<void>;
}
