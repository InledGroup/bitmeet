import type { CallRecord } from "./domain";

export interface ICallsRepository {
  addCallRecord(record: CallRecord): Promise<void>;
  listCallHistory(): Promise<CallRecord[]>;
  clearHistory(): Promise<void>;
}
