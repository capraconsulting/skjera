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
  /** The rows changed since the token pulled with, or all of them. */
  readonly rows: ReadonlyArray<Row>;
  /** Keys of the rows deleted since (or that the reader may no longer see). */
  readonly deleted: ReadonlyArray<string>;
  /**
   * `rows` are all there is: start over from them rather than apply them
   * to a copy. On a first pull, and whenever the token can't be pulled
   * from (see `snapsync.status()` in the extension).
   */
  readonly complete: boolean;
  /** To pull from next time. */
  readonly token: Token;
}

/** The schema of a pull's response, with rows of `row`. */
export const Pulled = <Row extends Schema.Top>(row: Row) =>
  Schema.Struct({
    rows: Schema.Array(row),
    deleted: Schema.Array(Schema.String),
    complete: Schema.Boolean,
    token: Token,
  });
