/**
 * The subset of expo-sqlite's SQLiteDatabase the repositories rely on.
 * Kept narrow so tests can run the same SQL against sql.js in Node.
 */
export type SqlParam = string | number | null;

export interface SqlDb {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlParam[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(source: string, params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlParam[]): Promise<T | null>;
}
