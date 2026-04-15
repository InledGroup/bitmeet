export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  type: 'meeting' | 'busy';
  meetingLink?: string;
  isNative: boolean;
  organizerPubKey: string;
  participants: string[]; // Public keys
  status: 'confirmed' | 'pending' | 'cancelled';
  groupId?: string;
}

export interface CalendarInvitation {
  id: string;
  eventId: string;
  organizerPubKey: string;
  organizerUsername: string;
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  meetingLink?: string;
  isNative: boolean;
  status: 'pending' | 'accepted' | 'rejected';
  receivedAt: number;
}
