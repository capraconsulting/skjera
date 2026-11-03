// The teams, events and signups that the **Events:** sections of
// docs/acceptance describe, written once as data. A change to such a section
// is made here too; test/testdata.test.ts holds the names to the docs.
//
// Unless a section says otherwise an event is published, in Europe/Oslo, in a
// place of its own, and public events are not open to guests. An event the
// section leaves unnamed is titled after the criterion it is for. Signups are
// made without emails: a criterion that reads the email sent when someone
// signs up has bob, or the guest, cancel and sign up again first.
import type { Temporal } from "temporal-polyfill";
import type {
  Block,
  EventSpec,
  QuestionSpec,
  SignupSpec,
  TeamSpec,
} from "./fill.ts";

type Time = Temporal.ZonedDateTime;

interface Span {
  readonly start: Time;
  readonly end: Time;
}

const oslo = "Europe/Oslo";

// ---- Times, worked out from when the command runs --------------------------

/** From a start, ending two hours later unless said. */
const span = (start: Time, hours = 2): Span => ({
  start,
  end: start.add({ hours }),
});

/** `days` ahead at `time`: always ahead, whenever the command runs. */
const daysAhead = (now: Time, days: number, time = "18:00"): Span =>
  span(now.add({ days }).withPlainTime(time));

const nextWeek = (now: Time) => daysAhead(now, 7);

const nextMonth = (now: Time): Span =>
  span(now.add({ months: 1 }).withPlainTime("18:00"));

/** Over: ended on a day `days` ago, in the evening. */
const over = (now: Time, days: number) =>
  span(now.subtract({ days }).withPlainTime("18:00"));

/** Starting in five minutes and lasting five more, so sign-up is open now. */
const inAFewMinutes = (now: Time): Span => ({
  start: now.add({ minutes: 5 }),
  end: now.add({ minutes: 10 }),
});

const goingOnNow = (now: Time): Span => ({
  start: now.subtract({ hours: 1 }),
  end: now.add({ hours: 1 }),
});

/** At least an hour ahead, on a full hour. */
const laterToday = (now: Time) =>
  span(
    now.add({ hours: 1 }).round({ smallestUnit: "hour", roundingMode: "ceil" }),
  );

/** Tomorrow 18:00 to 20:00 in New York, whichever zone the command runs in. */
const tomorrowInNewYork = (now: Time) =>
  span(
    now
      .withTimeZone("America/New_York")
      .add({ days: 1 })
      .withPlainTime("18:00"),
  );

/**
 * Today from 20:00 to 22:00 with its deadlines at 19:00 and 18:00, or the
 * same tomorrow once today's would have passed.
 */
const evening = (now: Time) => {
  const closing = now.withPlainTime("18:00").epochMilliseconds;
  const day =
    closing - now.epochMilliseconds > 2 * 60_000 ? now : now.add({ days: 1 });
  return {
    start: day.withPlainTime("20:00"),
    end: day.withPlainTime("22:00"),
    deadline: day.withPlainTime("19:00"),
    foodDeadline: day.withPlainTime("18:00"),
  };
};

// ---- Building blocks -------------------------------------------------------

/** An event in its own place; its times and settings come with `spec`. */
const event = (
  title: string,
  spec: Omit<EventSpec, "title"> = {},
): EventSpec => ({ title, place: "Kantina", ...spec });

/** Public, and open to guests. */
const guests = { public: true, guests: true } as const;

/** Public, and not open to guests. */
const members = { public: true } as const;

const bob = (spec: Omit<SignupSpec, "who"> = {}): SignupSpec => ({
  who: "bob",
  ...spec,
});

/** A guest of their own address, which a tester's own guests won't take. */
const guest = (
  feature: string,
  n: number,
  spec: Omit<SignupSpec, "who" | "name" | "email"> = {},
): SignupSpec => ({
  who: "guest",
  name: `Guest ${n}`,
  email: `${feature.toLowerCase()}-${n}@guests.example.org`,
  ...spec,
});

const towel: QuestionSpec = {
  key: "towel",
  type: "choice",
  text: "Towel size",
  options: ["Small", "Large"],
};
const heard = (required = false): QuestionSpec => ({
  key: "heard",
  type: "text",
  text: "Where did you hear of it?",
  required,
});
const friend: QuestionSpec = {
  key: "friend",
  type: "checkbox",
  text: "I bring a friend",
};

const text = (line: string): Block => ({ kind: "paragraph", text: line });

/** The text SITE-05 AC-2 asks for: a heading, bold words, a list and a link. */
const richBody: ReadonlyArray<Block> = [
  { kind: "heading", text: "What happens" },
  { kind: "paragraph", text: "Bring something warm to wear.", bold: "warm" },
  { kind: "item", text: "Coffee at six" },
  { kind: "item", text: "Talks at seven" },
  {
    kind: "paragraph",
    text: "Read more on the event's website.",
    link: { text: "website", href: "https://example.org/event" },
  },
];

/** Shared with a team of that name that may be made by hand. */
const capraId = "019f0000-0000-7000-8000-00000000c0a1";

const team = (
  name: string,
  events: ReadonlyArray<EventSpec>,
  more: Omit<TeamSpec, "name" | "events"> = {},
): TeamSpec => ({ name, events, ...more });

// ---- The catalogue ---------------------------------------------------------

/** The teams of every feature file with an **Events:** section, in file order. */
export const catalogue = (moment: Time): ReadonlyArray<TeamSpec> => {
  const now = moment
    .withTimeZone(oslo)
    .round({ smallestUnit: "minute", roundingMode: "floor" });
  const week = nextWeek(now);

  return [
    // ---- ACC, EXT -----------------------------------------------------------
    team("ACC-02: Logging out removes local copies of drafts", [
      event("AC-1: Kept on the server", {
        state: "draft",
        body: [text("A line of text, written before logging out.")],
      }),
    ]),
    team("ACC-06: Language: English, Bokmål and Nynorsk", [
      event("AC-2: Written in English", { ...guests, ...nextMonth(now) }),
    ]),
    team("EXT-01: Calendar invitations that calendar apps understand", [
      event("AC-1 to AC-7: Invited", { ...guests, ...week }),
    ]),
    team("EXT-02: Calendar subscription", [
      event("AC-2: Coming and public", {
        ...members,
        ...week,
        summary: "A public event with a summary",
      }),
      event("AC-2: Coming, members only", { ...daysAhead(now, 8) }),
      event("AC-3: Ended", { ...members, ...over(now, 3) }),
      event("AC-3: Not published", {
        ...members,
        ...daysAhead(now, 9),
        state: "draft",
      }),
      event("AC-3: Deleted", {
        ...members,
        ...daysAhead(now, 10),
        state: "deleted",
      }),
    ]),
    team("EXT-03: Embed", [
      event("AC-1 and AC-2: First", { ...members, ...daysAhead(now, 2) }),
      event("AC-3: Opens in a new tab", { ...members, ...daysAhead(now, 3) }),
      event("AC-1: Not among the first three", {
        ...members,
        ...daysAhead(now, 4),
      }),
      event("AC-1: Members only", { ...daysAhead(now, 2) }),
      event("AC-1: Not published", {
        ...members,
        ...daysAhead(now, 2),
        state: "draft",
      }),
    ]),
    team("EXT-04: API", [
      event("AC-1, AC-2 and AC-9: With a summary", {
        ...members,
        ...daysAhead(now, 3),
        summary: "A summary the websites can show",
      }),
      event("AC-4: Without a summary", { ...members, ...daysAhead(now, 4) }),
      event("AC-5: Streamed", {
        ...members,
        ...daysAhead(now, 5),
        streamed: true,
        streamLink: "https://example.org/stream",
      }),
      event("AC-5: Open to guests", { ...guests, ...daysAhead(now, 6) }),
      event("AC-6: Members only", { ...daysAhead(now, 7) }),
      event("AC-6: Not published", {
        ...members,
        ...daysAhead(now, 8),
        state: "draft",
      }),
    ]),
    team(
      "Capra Gruppen",
      [
        event('EXT-04 AC-3: Organiser "Alle"', {
          ...members,
          ...daysAhead(now, 9),
        }),
      ],
      { sharedId: capraId },
    ),
    team("EXT-06: HubSpot", [
      event("AC-1: Every page loads HubSpot's script", { ...guests, ...week }),
    ]),

    // ---- MAIL ---------------------------------------------------------------
    team("MAIL-01: Confirmation email when you sign up", [
      event("AC-1 to AC-4: Signed up", {
        ...guests,
        ...week,
        dietary: true,
        food: "Pizza",
        deadline: week.start.subtract({ days: 1 }),
      }),
      event("AC-5: Refused", { ...guests, ...week }),
    ]),
    team("MAIL-02: Email when you cancel", [
      event("AC-1 to AC-3: Cancelled signup", { ...guests, ...week }),
      event("AC-4: Taken off", { ...guests, ...week }),
    ]),
    team("MAIL-03: Email when the time or place changes", [
      event("AC-1 to AC-5: Moved", {
        ...guests,
        ...week,
        signups: [bob(), guest("MAIL-03", 1)],
      }),
    ]),
    team("MAIL-04: Email when the event is cancelled", [
      event("AC-1 to AC-3: Cancelled", {
        ...guests,
        ...week,
        signups: [bob(), guest("MAIL-04", 1)],
      }),
      event("AC-4: Over", {
        ...guests,
        ...inAFewMinutes(now),
        signups: [bob()],
      }),
    ]),
    team("MAIL-05: Reminder the morning before", [
      event("AC-1 to AC-3: Reminded", {
        ...guests,
        ...daysAhead(now, 2, "12:00"),
        remind: "on",
        signups: [bob(), guest("MAIL-05", 1)],
      }),
      event("AC-4: Deleted", {
        ...guests,
        ...daysAhead(now, 2, "12:00"),
        remind: "on",
        signups: [bob()],
      }),
    ]),
    team("MAIL-06: Each event's own email texts", [
      event("AC-2, AC-3 and AC-5: Own texts", {
        ...guests,
        ...week,
        emails: {
          signedUp: {
            subject: "Welcome aboard",
            text: "We look forward to it.",
          },
          signupCancelled: {
            subject: "Sorry to see you go",
            text: "You can always sign up again.",
          },
          eventChanged: {
            subject: "We moved it",
            text: "Please note the new time.",
          },
          eventCancelled: {
            subject: "It is off",
            text: "We will be back with another event.",
          },
        },
      }),
      event("AC-4: Standard texts", { ...guests, ...week }),
      event("AC-6: Cancelled after an unpublished change", {
        ...guests,
        ...week,
        emails: {
          eventCancelled: { text: "The published text of the cancellation." },
        },
        signups: [bob()],
      }),
    ]),
    team("MAIL-07: Emails in the language you signed up in", [
      event("AC-1 to AC-4: Languages", { ...guests, ...week }),
    ]),

    // ---- SIGN ---------------------------------------------------------------
    team("SIGN-01: Members sign up and cancel", [
      event("AC-1: A member signs up", { ...members, ...week }),
    ]),
    team("SIGN-02: Guests sign up with name and email", [
      event("AC-1: The guest form", { ...guests, ...week }),
      event("AC-6: Not open to guests, no form", { ...members, ...week }),
    ]),
    team("SIGN-03: Phone and company for guests", [
      event("AC-1: The guest form offers both, optional", {
        ...guests,
        ...week,
      }),
    ]),
    team("SIGN-04: A guest's own link to their signup", [
      event("AC-1: The link is in the email", { ...guests, ...week }),
    ]),
    team("SIGN-05: Sign-up deadline", [
      event("AC-1: The page says when sign-up closes", { ...guests, ...week }),
      event("AC-2: Closed, with no buttons", {
        ...guests,
        ...week,
        questions: [heard()],
      }),
      event("AC-4: The deadline can't be after the start", {
        ...guests,
        ...week,
      }),
      event("AC-5: The food deadline is shown", {
        ...guests,
        ...week,
        dietary: true,
        food: "Pizza",
        foodDeadline: week.start.subtract({ days: 2 }),
      }),
      event("AC-6: After the food deadline, no dietary preferences", {
        ...guests,
        ...week,
        dietary: true,
        food: "Pizza",
        foodDeadline: now.subtract({ hours: 1 }),
      }),
      event("AC-7: The food deadline can't be after sign-up closes", {
        ...guests,
        ...week,
        dietary: true,
        food: "Pizza",
        deadline: week.start.subtract({ days: 1 }),
      }),
    ]),
    team("SIGN-06: Maximum number of attendees", [
      event("AC-1: The limit is set in the studio", {
        ...guests,
        ...week,
        maxAttendees: 2,
      }),
      event("AC-2: Members and guests both count", {
        ...guests,
        ...week,
        maxAttendees: 2,
      }),
      event("AC-3: A full event refuses new sign-ups", {
        ...guests,
        ...week,
        maxAttendees: 2,
      }),
      event("AC-5: Those signed up can still change and cancel", {
        ...guests,
        ...week,
        maxAttendees: 2,
        questions: [towel],
        signups: [
          bob({ answers: { towel: "Small" } }),
          guest("SIGN-06", 1, { answers: { towel: "Large" } }),
        ],
      }),
      event("AC-6: A freed place can be taken", {
        ...guests,
        ...week,
        maxAttendees: 2,
        signups: [bob(), guest("SIGN-06", 2)],
      }),
      event("AC-7: Places left are shown", {
        ...guests,
        ...week,
        maxAttendees: 2,
      }),
      event("AC-8: Full, in place of the form", {
        ...guests,
        ...week,
        maxAttendees: 2,
        signups: [bob(), guest("SIGN-06", 3)],
      }),
      event("AC-9: A limit below those signed up", {
        ...guests,
        ...week,
        maxAttendees: 2,
        signups: [bob(), guest("SIGN-06", 4)],
      }),
    ]),
    team("SIGN-07: Streaming, in person or online", [
      event("AC-1: Streaming is set in the studio", {
        ...guests,
        ...week,
        streamed: true,
      }),
      event("AC-2: Everyone sees the link", {
        ...guests,
        ...week,
        streamed: true,
      }),
      event("AC-3: In person or online must be chosen", {
        ...guests,
        ...week,
        streamed: true,
      }),
      event("AC-4: The choice can be changed until sign-up closes", {
        ...guests,
        ...week,
        streamed: true,
      }),
      event("AC-5: Attendees and the spreadsheet show how each comes", {
        ...guests,
        ...week,
        streamed: true,
      }),
      event("AC-6: Only those in person count against the limit", {
        ...guests,
        ...week,
        streamed: true,
        maxAttendees: 2,
      }),
      event("AC-7: Not streamed, everyone counts as in person", {
        ...guests,
        ...week,
        streamed: true,
        maxAttendees: 2,
      }),
    ]),
    team("SIGN-08: Dietary preferences, without a name", [
      ...[
        "AC-1: The field is offered, and optional",
        "AC-2: Kept without a name",
        "AC-3: An empty field is accepted, and stores nothing",
        "AC-4: The organiser sees the list and the count",
        "AC-5: Not in the attendee list or the spreadsheet",
        "AC-6: Changing or cancelling leaves them",
      ].map((title) =>
        event(title, {
          ...guests,
          ...week,
          dietary: true,
          food: "Pizza",
          foodDeadline: week.start.subtract({ days: 1 }),
        }),
      ),
    ]),
    team("SIGN-09: Custom questions on the sign-up form", [
      event("AC-1: The form asks the event's questions", {
        ...guests,
        ...week,
        questions: [
          heard(),
          {
            key: "risk",
            type: "checkbox",
            text: "I accept the risks of swimming",
            required: true,
          },
          { ...towel, required: true },
        ],
      }),
    ]),
    team("SIGN-10: Changing answers after signing up", [
      event("AC-1: The form starts from what was given", {
        ...guests,
        ...week,
        questions: [towel],
      }),
      event("AC-2: Saved answers replace the old ones", {
        ...guests,
        ...week,
        questions: [towel],
      }),
      event("AC-3: Keep as is changes nothing", {
        ...guests,
        ...week,
        questions: [towel],
      }),
      event("AC-4: Changes are checked like a sign-up", {
        ...guests,
        ...week,
        questions: [towel, heard(true)],
      }),
      event("AC-5: Dietary preferences aren't asked again", {
        ...guests,
        ...week,
        questions: [towel],
        dietary: true,
        food: "Pizza",
      }),
      event("AC-7: Not after sign-up closes", {
        ...guests,
        ...week,
        questions: [towel],
      }),
      event("AC-8: From another browser too", {
        ...guests,
        ...week,
        questions: [{ ...towel, required: true }],
      }),
    ]),
    team("SIGN-11: Attendee list in the studio", [
      event("AC-1: Everyone signed up, with a count", {
        ...guests,
        ...week,
        questions: [towel, friend],
      }),
      event("AC-8: Ended", {
        ...guests,
        ...inAFewMinutes(now),
        signups: [guest("SIGN-11", 1)],
      }),
    ]),
    team("SIGN-12: Downloading attendees as CSV", [
      event("AC-1: A file named after the event", {
        ...guests,
        ...week,
        questions: [towel, heard()],
        signups: [
          bob({ answers: { towel: "Small", heard: "A colleague" } }),
          guest("SIGN-12", 1, {
            answers: { towel: "Large", heard: "A poster" },
          }),
        ],
      }),
    ]),
    team("SIGN-15: Invitations in the studio", [
      event("AC-1: A section for each event", { ...guests, ...week }),
    ]),

    // ---- SITE ---------------------------------------------------------------
    team("SITE-02: Front page: upcoming and past events", [
      event("AC-1: Coming", { ...members, ...daysAhead(now, 1) }),
      event("AC-1: Later", { ...members, ...daysAhead(now, 8) }),
      event("AC-3: Members only", { ...daysAhead(now, 3) }),
      event("AC-4: Today", {
        ...members,
        ...laterToday(now),
        tags: ["Workshop"],
      }),
      event("AC-5: Going on now", { ...members, ...goingOnNow(now) }),
      event("AC-6: Signed up", {
        ...guests,
        ...daysAhead(now, 5),
        signups: [bob(), guest("SITE-02", 1)],
      }),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) =>
        event(`AC-7: Past ${n}`, {
          ...members,
          ...over(now, 8 - n),
          cover: "purple",
          tags: ["Past 7"],
        }),
      ),
    ]),
    team("SITE-03: Filter by tag", [
      event("AC-1: Coming", {
        ...members,
        ...daysAhead(now, 4),
        tags: ["Pottery 7"],
      }),
      event("AC-1: Was", {
        ...members,
        ...over(now, 4),
        tags: ["Pottery 7", "Weaving 7"],
      }),
      event("AC-1: Untagged", { ...members, ...daysAhead(now, 5) }),
    ]),
    team("SITE-04: Filter on who can sign up", [
      event("AC-1: Open to guests", {
        ...guests,
        ...daysAhead(now, 4),
        tags: ["Filter 4"],
      }),
      event("AC-1: Not open to guests", { ...members, ...daysAhead(now, 5) }),
      event("AC-2: Over, open to guests", {
        ...guests,
        ...over(now, 5),
        tags: ["Filter 4"],
      }),
      event("AC-2: Over, not open to guests", { ...members, ...over(now, 6) }),
    ]),
    team("SITE-05: The event page", [
      event("AC-1: Times", { ...members, ...tomorrowInNewYork(now) }),
      event("AC-2: Text", {
        ...members,
        ...week,
        cover: "teal",
        tags: ["Workshop"],
        body: richBody,
      }),
      event("AC-3: Food", {
        ...members,
        ...week,
        dietary: true,
        food: "Pizza",
      }),
      event("AC-5: Deleted", { ...members, ...week, state: "deleted" }),
      event("AC-5: Draft", { ...members, ...week, state: "draft" }),
    ]),
    team("SITE-06: Who's coming", [
      event("AC-1: Members' names, with their count", {
        ...guests,
        ...week,
        signups: [bob(), guest("SITE-06", 1)],
      }),
      event("AC-3: An empty list says so", { ...guests, ...week }),
    ]),
    team("SITE-07: Members-only events", [
      event("AC-1: Members only", {
        ...week,
        summary: "A members-only event, opened from its link.",
        cover: "purple",
        body: [
          text("Text of a members-only event, shown to anyone with its link."),
        ],
      }),
      event("AC-3: Made members-only", { ...members, ...week }),
    ]),
    team("SITE-08: Summary and sharing", [
      event("AC-2: The page shows it under the title", {
        ...members,
        ...week,
        summary: "A short summary of the event, shown under its title.",
        cover: "orange",
        signups: [bob()],
      }),
      event("AC-5: A members-only event shares its title, summary and image", {
        ...week,
        summary: "A members-only event, shared with its summary.",
        cover: "teal",
        body: [
          text("Text of a members-only event, shown to anyone with its link."),
        ],
      }),
    ]),
    team("SITE-09: The site updates without reloading", [
      event("AC-1: New", { ...members, ...week, state: "draft" }),
      event("AC-2: Changed", { ...members, ...week }),
      event("AC-3: Deleted", { ...members, ...week }),
      event("AC-4: Count", { ...members, ...week }),
    ]),
    team("SITE-10: Privacy page", [
      event("AC-5: A link from the guest form", { ...guests, ...week }),
    ]),

    // ---- STU ----------------------------------------------------------------
    team("STU-01: Teams", [event("AC-5: Keeps its team", { state: "titled" })]),
    team(
      "STU-02: Logo for light and dark",
      [event("AC-2: The organiser", { ...members, ...week })],
      { logo: "red", logoDark: "blue" },
    ),
    team(
      "STU-02: Light logo only",
      [event("AC-2: The organiser", { ...members, ...week })],
      { logo: "green" },
    ),
    team("STU-02: No logo", [
      event("AC-2: The organiser", { ...members, ...week }),
    ]),
    team("STU-03: Events in a team", [
      event("AC-3: Status", { ...members, ...week, state: "draft" }),
    ]),
    team("STU-03: No events", []),
    team("STU-04: Editing an event together, live", [
      event("AC-1: Live", { state: "titled" }),
      event("AC-2: At once", { state: "draft", body: [text("Hello")] }),
      event("AC-3: Fields", { state: "titled" }),
    ]),
    team("STU-05: Who else has the event open", [
      event("AC-1 to AC-5: Presence", { state: "titled" }),
    ]),
    team("STU-06: Saving, and editing offline", [
      event("AC-1: Saved", { state: "titled" }),
      event("AC-2 and AC-3: Offline", { state: "titled" }),
    ]),
    team("STU-07: The event text: formatting and links", [
      event("AC-1 to AC-5: Formatting", {
        ...members,
        ...week,
        state: "draft",
      }),
    ]),
    team("STU-08: Images in the event text", [
      event("AC-1 to AC-5: Images", { ...members, ...week, state: "draft" }),
    ]),
    team("STU-09: Cover image", [
      event("AC-1 to AC-5: Cover", {
        ...members,
        ...nextMonth(now),
        state: "draft",
      }),
    ]),
    team("STU-10: Times, time zone and deadlines", [
      event("AC-1: Start and end", { ...members, state: "draft" }),
      event("AC-2: Own zone", { ...members, ...week, state: "draft" }),
      event("AC-3: New York", { ...members, ...week, state: "draft" }),
      event("AC-4: Deadline", { ...members, ...week, state: "draft" }),
      event("AC-5: Food deadline", { ...members, ...week, state: "draft" }),
    ]),
    team("STU-11: An event has a place", [
      event("AC-1 to AC-6: With a place", {
        ...members,
        ...week,
        signups: [bob()],
      }),
    ]),
    team("STU-12: Who sees the event, and whether guests can sign up", [
      event("AC-1: New", { state: "titled" }),
      event("AC-2 and AC-3: Members only", { ...week }),
      event("AC-4 and AC-5: Open to guests", { ...guests, ...week }),
      event("AC-5: Public, no guests", { ...members, ...week }),
    ]),
    team("STU-13: Food, reminders and other event settings", [
      event("AC-1 to AC-3: Food", {
        ...guests,
        ...week,
        dietary: true,
        food: "Pizza",
      }),
      event("AC-3: No food", { ...guests, ...week }),
      event("AC-5: Standard, open to guests", {
        ...guests,
        ...daysAhead(now, 2, "12:00"),
        remind: "default",
        signups: [bob()],
      }),
      event("AC-5: Standard, members only", {
        ...members,
        ...daysAhead(now, 2, "12:00"),
        remind: "default",
        signups: [bob()],
      }),
      event("AC-6: On, members only", {
        ...members,
        ...daysAhead(now, 2, "12:00"),
        remind: "on",
        signups: [bob()],
      }),
      event("AC-6: Off, open to guests", {
        ...guests,
        ...daysAhead(now, 2, "12:00"),
        remind: "off",
        signups: [bob()],
      }),
    ]),
    team("STU-14: Questions on the sign-up form", [
      event("AC-1 to AC-7: Questions", { ...guests, ...week, state: "draft" }),
    ]),
    team("STU-15: Tags", [
      event("AC-1 to AC-3: Tagged", { ...members, ...week, state: "draft" }),
      event("AC-4 and AC-5: Suggested", {
        ...members,
        ...week,
        state: "draft",
      }),
    ]),
    team("STU-16: Recurring events", [
      event("AC-1: Not recurring", { ...members, ...nextMonth(now) }),
      event("AC-2, AC-3 and AC-5: Every other week", {
        ...members,
        ...evening(now),
        dietary: true,
        food: "Pizza",
        repeat: { every: 2, unit: "week" },
        signups: [bob({ dietary: "No nuts" })],
      }),
      event("AC-7: Recurring, not published", {
        ...evening(now),
        state: "draft",
        repeat: { every: 1, unit: "day" },
      }),
    ]),
    team("STU-17: Publishing", [
      event("AC-1, AC-4 and AC-5: Published", {
        ...members,
        ...week,
        state: "draft",
      }),
      event("", { state: "empty" }),
      event("AC-6: Unsaved", { ...members, ...week }),
    ]),
    team("STU-18: Confirming a new time before publishing it", [
      event("AC-1 to AC-3: One signed up", {
        ...guests,
        ...week,
        signups: [guest("STU-18", 1)],
      }),
      event("AC-4: Two signed up", {
        ...guests,
        ...week,
        signups: [bob(), guest("STU-18", 2)],
      }),
      event("AC-5: A new place", {
        ...guests,
        ...week,
        signups: [guest("STU-18", 3)],
      }),
      event("AC-6: Nobody signed up", { ...guests, ...week }),
      event("AC-6: A new title", {
        ...guests,
        ...week,
        signups: [guest("STU-18", 4)],
      }),
    ]),
    team("STU-19: Deleting an event", [
      event("AC-1: Not published", { ...guests, ...week, state: "draft" }),
      event("AC-2 to AC-5: Signed up", {
        ...guests,
        ...daysAhead(now, 1),
        signups: [bob(), guest("STU-19", 1)],
      }),
      event("AC-6: Ended", {
        ...guests,
        ...inAFewMinutes(now),
        signups: [guest("STU-19", 2)],
      }),
    ]),
    team("STU-20: Unpublishing", [
      event("AC-1: Not published", { ...guests, ...week, state: "draft" }),
      event("AC-2 to AC-10: Signed up", {
        ...guests,
        ...daysAhead(now, 1),
        signups: [bob(), guest("STU-20", 1)],
      }),
      event("AC-3: Nobody signed up", { ...guests, ...daysAhead(now, 1) }),
      event("AC-8: Ended", {
        ...guests,
        ...inAFewMinutes(now),
        signups: [guest("STU-20", 2)],
      }),
      event("AC-10: Weekly", {
        ...guests,
        ...over(now, 2),
        repeat: { every: 1, unit: "week" },
      }),
    ]),
  ];
};
