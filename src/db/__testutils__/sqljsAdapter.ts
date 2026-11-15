import initSqlJs, { type Database } from 'sql.js';

import type { SqlDb, SqlParam } from '../sql';

/** Runs the app's SQL against an in-memory sql.js database so repository tests exercise real SQLite. */
export async function openTestDb(): Promise<SqlDb & { raw: Database }> {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();

  const all = <T>(source: string, params: SqlParam[]): T[] => {
    const stmt = raw.prepare(source);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  };

  return {
    raw,
    async execAsync(source) {
      raw.exec(source);
    },
    async runAsync(source, params) {
      raw.run(source, params);
      const id = all<{ id: number }>('SELECT last_insert_rowid() AS id', [])[0]?.id ?? 0;
      return { lastInsertRowId: id, changes: raw.getRowsModified() };
    },
    async getAllAsync<T>(source: string, params: SqlParam[]) {
      return all<T>(source, params);
    },
    async getFirstAsync<T>(source: string, params: SqlParam[]) {
      return all<T>(source, params)[0] ?? null;
    },
  };
}
