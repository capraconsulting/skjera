# STU-15: Tags

An organiser tags an event with what it is about, such as «Workshop». The studio suggests tags already published, and the site shows an event's tags.

**Events:** in team «STU-15: Tags», public events:

- «AC-1 to AC-6: Tagged», with no tags yet.
- «AC-4 to AC-5: Suggested», with no tags.

For a tag nobody has used before, take a word and today's date, such as «Pottery 20 Oct», and a new one each time a criterion asks for one.

## AC-1: A tag is added as typed

The studio SHALL let an organiser add a tag by typing it and pressing Enter, offering it as a new tag when no published event has it, and marking it so to screen readers in the interface's language.

**Test**

- **Given** «AC-1 to AC-6: Tagged» open in the studio
- **When** you type a new tag in **Tags**
- **Then** the list offers it with a «+» in front, as a new tag; to a screen reader it reads «(new tag)», «(ny emneknagg)» in Bokmål and Nynorsk
- **When** you press Enter
- **Then** it is shown as a pill above the field, and the field is empty again

**Automated:** `packages/app/e2e/specs/studio/tags.spec.ts`, `packages/app/e2e/specs/tooling/language.spec.ts`

## AC-2: A tag is removed

The studio SHALL let an organiser take a tag off an event.

**Test**

- **Given** «AC-1 to AC-6: Tagged» with a tag
- **When** you click **×** on its pill
- **Then** the tag is gone

**Automated:** `packages/app/e2e/specs/studio/tags.spec.ts`

## AC-3: Each tag once, whatever the letters

IF an organiser adds a tag the event already has, in the same or other capital letters, THEN the studio SHALL keep it once.

**Test**

- **Given** «AC-1 to AC-6: Tagged»
- **When** you add «Workshop» as in AC-1, then type «workshop» in **Tags**
- **Then** the list offers no new tag for it, and the event keeps one «Workshop»

**Automated:** `packages/documents/test/events/content.test.ts`

## AC-4: Published tags are suggested

The studio SHALL suggest the tags of every published event, matching what is typed anywhere in the tag and whatever the capital letters, and SHALL add a suggestion as it is spelled there.

**Test**

- **Given** «AC-1 to AC-6: Tagged», published with «Workshop»
- **When** you open «AC-4 to AC-5: Suggested» and type «shop» in **Tags**
- **Then** «Workshop» is suggested
- **When** you pick it
- **Then** the event gets «Workshop», spelled as on the other event

**Automated:** `packages/app/e2e/specs/studio/tags.spec.ts`, `packages/documents/test/events/content.test.ts`

## AC-5: Only published tags are suggested

IF a tag has only been added to drafts, and never published, THEN the studio SHALL not suggest it on other events.

**Test**

- **Given** another new tag, added to «AC-4 to AC-5: Suggested» and taken off again before it is published
- **When** you type the start of it on «AC-1 to AC-6: Tagged»
- **Then** it is offered only with a «+», as a new tag

**Automated:** `packages/documents/test/events/content.test.ts`

## AC-6: The event page shows the tags

The event page SHALL show the event's published tags, each a link to the front page showing only the upcoming events with that tag.

**Test**

- **Given** «AC-1 to AC-6: Tagged», published with «Workshop»
- **When** you open it on the site and click «Workshop»
- **Then** the front page shows only upcoming events tagged «Workshop»

**Automated:** `packages/app/e2e/specs/studio/tags.spec.ts`
