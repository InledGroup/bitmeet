export interface CallRecord {
  id: string;
  type: 'incoming' | 'outgoing' | 'missed';
  remotePubKey: string;
  remoteUsername: string;
  startTime: number;
  duration?: number; // in seconds
  isVideo: boolean;
}
