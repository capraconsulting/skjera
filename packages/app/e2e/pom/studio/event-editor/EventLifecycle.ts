/** What `createPublished` sets before publishing. */
export interface EventSettings {
  readonly public: boolean;
  readonly past?: boolean;
  readonly guests?: boolean;
  readonly dietary?: boolean;
  /** The most who can sign up; none by default. */
  readonly maxAttendees?: number;
  /** Streamed, with a link to the stream if given; not streamed by default. */
  readonly streamed?: { readonly link?: string };
  /** Tags, added one by one; none by default. */
  readonly tags?: ReadonlyArray<string>;
}

/** A published event, as `createPublished` returns it. */
export interface PublishedEvent {
  readonly id: string;
  readonly title: string;
}
