// ===== 访问记录仓库 =====

import type { VisitRecord } from '../../shared/types';
import {
  openDatabase,
  dbGetAllByIndex,
  dbPut,
  dbDelete,
  dbClear,
  DB_NAME,
  DB_VERSION,
} from '../db';
import { applyMigrations } from '../migrations';

let visitSeq = 0;

export function makeVisitId(prefix = 'v'): string {
  visitSeq = (visitSeq + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${visitSeq.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class VisitRepository {
  private dbPromise: Promise<IDBDatabase>;

  constructor(db?: IDBDatabase) {
    this.dbPromise = db ? Promise.resolve(db) : openDatabase(DB_NAME, DB_VERSION, applyMigrations);
  }

  async create(record: VisitRecord): Promise<void> {
    const db = await this.dbPromise;
    await dbPut(db, 'visits', record);
  }

  async listByPageId(pageId: string): Promise<VisitRecord[]> {
    const db = await this.dbPromise;
    const records = await dbGetAllByIndex<VisitRecord>(db, 'visits', 'pageId', pageId);
    return records.sort((a, b) => a.startedAt - b.startedAt);
  }

  async countByPageId(pageId: string): Promise<number> {
    const db = await this.dbPromise;
    const records = await dbGetAllByIndex<VisitRecord>(db, 'visits', 'pageId', pageId);
    return records.length;
  }

  async deleteByPageId(pageId: string): Promise<void> {
    const db = await this.dbPromise;
    const records = await dbGetAllByIndex<VisitRecord>(db, 'visits', 'pageId', pageId);
    for (const record of records) {
      await dbDelete(db, 'visits', record.id);
    }
  }

  async deleteAll(): Promise<void> {
    const db = await this.dbPromise;
    await dbClear(db, 'visits');
  }
}
