// Narrow runtime contracts for the installed pg driver; no legacy metadata dependencies.
declare module 'pg' {
  export interface QueryResultRow { [column: string]: unknown }
  export interface QueryResult<T extends QueryResultRow> {
    rows: T[];
    rowCount: number | null;
  }
  export class PoolClient {
    query<T extends QueryResultRow = QueryResultRow>(statement: string, params?: unknown[]): Promise<QueryResult<T>>;
    release(): void;
  }
  export class Pool {
    constructor(options: { connectionString: string; ssl?: { ca: string; rejectUnauthorized: boolean; servername: string }; max?: number; connectionTimeoutMillis?: number });
    query<T extends QueryResultRow = QueryResultRow>(statement: string, params?: unknown[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
