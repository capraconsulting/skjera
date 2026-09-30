import { Schema } from "effect";

export class DocumentNotFound extends Schema.TaggedError<DocumentNotFound>()(
  "DocumentNotFound",
  { id: Schema.String },
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
) {}

/** Empty, too long, or already used by another team (names ignore case). */
export class InvalidTeamName extends Schema.TaggedError<InvalidTeamName>()(
  "InvalidTeamName",
  { message: Schema.String },
) {}

/** Only teams without events can be deleted. */
export class TeamNotEmpty extends Schema.TaggedError<TeamNotEmpty>()(
  "TeamNotEmpty",
  { id: Schema.String },
) {}
