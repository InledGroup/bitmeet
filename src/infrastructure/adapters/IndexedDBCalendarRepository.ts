import type { CalendarEvent, CalendarInvitation } from "../../core/calendar/domain";
import type { ICalendarRepository } from "../../core/calendar/ports";

export class IndexedDBCalendarRepository implements ICalendarRepository {
  private dbName = "BitMeet_Calendar";
  private eventsStore = "events";
  private invitationsStore = "invitations";
  private db: IDBDatabase | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e: any) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.eventsStore)) {
          db.createObjectStore(this.eventsStore, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(this.invitationsStore)) {
          db.createObjectStore(this.invitationsStore, { keyPath: "id" });
        }
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => reject(request.error);
    });
  }

  async saveEvent(event: CalendarEvent): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.eventsStore, "readwrite");
    await this.promisify(tx.objectStore(this.eventsStore).put(event));
  }

  async getEvent(id: string): Promise<CalendarEvent | null> {
    const db = await this.getDB();
    const tx = db.transaction(this.eventsStore, "readonly");
    const event = await this.promisify(tx.objectStore(this.eventsStore).get(id));
    return event || null;
  }

  async deleteEvent(id: string): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.eventsStore, "readwrite");
    await this.promisify(tx.objectStore(this.eventsStore).delete(id));
  }

  async listEvents(startTime: number, endTime: number): Promise<CalendarEvent[]> {
    const db = await this.getDB();
    const tx = db.transaction(this.eventsStore, "readonly");
    const all: CalendarEvent[] = await this.promisify(tx.objectStore(this.eventsStore).getAll());
    return all.filter(e => 
      (e.startTime >= startTime && e.startTime <= endTime) ||
      (e.endTime >= startTime && e.endTime <= endTime) ||
      (e.startTime <= startTime && e.endTime >= endTime)
    );
  }

  async saveInvitation(invitation: CalendarInvitation): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.invitationsStore, "readwrite");
    await this.promisify(tx.objectStore(this.invitationsStore).put(invitation));
  }

  async getInvitation(id: string): Promise<CalendarInvitation | null> {
    const db = await this.getDB();
    const tx = db.transaction(this.invitationsStore, "readonly");
    const invitation = await this.promisify(tx.objectStore(this.invitationsStore).get(id));
    return invitation || null;
  }

  async deleteInvitation(id: string): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.invitationsStore, "readwrite");
    await this.promisify(tx.objectStore(this.invitationsStore).delete(id));
  }

  async listInvitations(): Promise<CalendarInvitation[]> {
    const db = await this.getDB();
    const tx = db.transaction(this.invitationsStore, "readonly");
    const all = await this.promisify(tx.objectStore(this.invitationsStore).getAll());
    return all.sort((a: any, b: any) => b.receivedAt - a.receivedAt);
  }

  async updateInvitationStatus(id: string, status: 'accepted' | 'rejected'): Promise<void> {
    const invitation = await this.getInvitation(id);
    if (invitation) {
      invitation.status = status;
      await this.saveInvitation(invitation);
    }
  }

  private promisify(request: IDBRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
