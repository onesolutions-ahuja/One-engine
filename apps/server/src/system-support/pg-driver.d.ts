// Narrow runtime contracts for the installed pg driver; no legacy metadata dependencies.
declare module 'pg' {
  export interface QueryResultRow { [column: string]: unknown }
  export interface QueryResult<T extends QueryResultRow> {
    rows: T[];
    rowCount: number | null;
  }
  export class PoolClient {
    query<T extends QueryResultRow = QueryResultRow>(statement: string, params?: unknown[]): Promise<QueryResult<T>>;
    /** true/an Error: the connection is closed instead of returned to the pool. */
    release(destroy?: boolean | Error): void;
    /** LISTEN notices (live changes) and connection loss. */
    on(event: 'notification', listener: (message: { channel: string; payload?: string }) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'end', listener: () => void): this;
  }
  export class Pool {
    constructor(options: { connectionString: string; ssl?: { ca: string; rejectUnauthorized: boolean; servername: string }; max?: number; connectionTimeoutMillis?: number });
    query<T extends QueryResultRow = QueryResultRow>(statement: string, params?: unknown[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
