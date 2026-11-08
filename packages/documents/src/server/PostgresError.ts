import type { SqlError } from "effect/sql";

const pgCause = (error: SqlError.SqlError) =>
  (error.reason as { cause?: { code?: string; message?: string } }).cause;

export const pgCode = (error: SqlError.SqlError): string | undefined =>
  pgCause(error)?.code;

export const pgMessage = (error: SqlError.SqlError): string =>
  pgCause(error)?.message ?? error.message;
