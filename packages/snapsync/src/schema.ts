import { Schema } from "effect";

// What goes over the wire between a server and the clients keeping copies of
// its tables. Safe to import anywhere.

/**
 * Where a client got to in a table: the database it pulled from, the
 * table's generation, and which transactions it had seen
 * ("1/<cluster>/<database>/<generation>/<snapshot>"). Opaque to clients:
 * they keep the latest and send it with their next pull of that table.
 */
export const Token = Schema.String.check(Schema.isMaxLength(100_000));
export type Token = typeof Token.Type;

/** What a pull returns, with rows of type `Row`. */
export interface Pulled<Row> {
  /** Rows changed since the token pulled with (or all, starting over). */
  readonly rows: ReadonlyArray<Row>;
  /** Keys of the rows deleted since (or that the reader may no longer see). */
  readonly deleted: ReadonlyArray<string>;
  /**
   * Starting over: these rows, and those of the pages after it up to the
   * last (without `more`), replace the copy. On a first pull, and whenever
   * the token can't be pulled from (see `snapsync.status()`).
   */
  readonly complete: boolean;
  /**
   * There's more already: pull again with `token` right away. A copy
   * starting over has all of it only after the last page.
   */
  readonly more: boolean;
  /** To pull from next. */
  readonly token: Token;
}

/** The schema of a pull's response, with rows of `row`. */
export const Pulled = <Row extends Schema.Top>(row: Row) =>
  Schema.Struct({
    rows: Schema.Array(row),
    deleted: Schema.Array(Schema.String),
    complete: Schema.Boolean,
    more: Schema.Boolean,
    token: Token,
  });
