import { Schema } from "effect";

/**
 * The signed-in user as reported by the identity provider.
 *
 * `issuer` + `subject` is the stable key for a user. Email and name are
 * informational and may be missing or change over time.
 */
export class Identity extends Schema.Class<Identity>("@skjera/oauth/Identity")({
  issuer: Schema.String,
  subject: Schema.String,
  email: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  /** The profile picture's address (https), where the provider gives one. */
  picture: Schema.optional(Schema.String),
}) {}
