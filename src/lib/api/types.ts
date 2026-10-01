import type { Db } from '../db/client';
import type { Qbit } from '../qbit';
import type { ApiHeaders } from './tokens';

export type ApiRequest = { method: string; path: string[]; query: URLSearchParams; body: unknown; headers: ApiHeaders };
export type ApiResponse = { status: number; body: unknown };
export type ApiDeps = { qbit: Qbit | null; logDir: string; today: string; now: number; version: string; fetchImpl?: typeof fetch };
export type ApiCtx = { db: Db; deps: ApiDeps; params: Record<string, string>; query: URLSearchParams; body: Record<string, unknown> };
export type Route = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; pattern: string; run: (c: ApiCtx) => unknown };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
