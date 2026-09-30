import { Schema } from "effect";

export class DocumentNotFound extends Schema.TaggedError<DocumentNotFound>()(
  "DocumentNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

/** The changes are malformed, miss dependencies, or reuse an actor id. */
export class InvalidChanges extends Schema.TaggedError<InvalidChanges>()(
  "InvalidChanges",
  { message: Schema.String },
) {}

/** The changes were made under an actor id that isn't the sender's. */
export class ActorNotAllowed extends Schema.TaggedError<ActorNotAllowed>()(
  "ActorNotAllowed",
  { actor: Schema.String },
) {}

/** The changes would leave the draft in a shape its content type doesn't allow. */
export class InvalidContent extends Schema.TaggedError<InvalidContent>()(
  "InvalidContent",
  { message: Schema.String },
) {}

export class PublishRejected extends Schema.TaggedError<PublishRejected>()(
  "PublishRejected",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** No published event with that id (it may exist as an unpublished draft). */
export class EventNotFound extends Schema.TaggedError<EventNotFound>()(
  "EventNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

export class TeamNotFound extends Schema.TaggedError<TeamNotFound>()(
  "TeamNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Empty, too long, or already used by another team (names ignore case). */
export class InvalidTeamName extends Schema.TaggedError<InvalidTeamName>()(
  "InvalidTeamName",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** Only teams without events can be deleted. */
export class TeamNotEmpty extends Schema.TaggedError<TeamNotEmpty>()(
  "TeamNotEmpty",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Attending as a member needs a login. */
export class SignInRequired extends Schema.TaggedError<SignInRequired>()(
  "SignInRequired",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/** The event doesn't take this signup, e.g. guests on a members-only event. */
export class SignupRejected extends Schema.TaggedError<SignupRejected>()(
  "SignupRejected",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** No guest signup matches that cancel token. */
export class SignupNotFound extends Schema.TaggedError<SignupNotFound>()(
  "SignupNotFound",
  {},
  { httpApiStatus: 404 },
) {}
