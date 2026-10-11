/** Persistable writes produced only by trusted server code, never by clients. */
export type SqlValue = string | number | null;
export interface SqlWrite { query: string; values: SqlValue[] }
export const sql = (query: string) => ({ bind: (...values: SqlValue[]): SqlWrite => ({ query, values }) });
export const statements = (db: D1Database, writes: SqlWrite[]) => writes.map(write => db.prepare(write.query).bind(...write.values));
