# SITE-03: Filter by tag

Events are tagged in the studio, and the front page filters them by tag. Tags no other event has are unlikely in the development database, so make them your own, such as «Pottery 7».

**Events:** public events, tagged in the studio under **Tags**:

- «AC-1: Coming», coming up, with the tag «Pottery 7».
- «AC-1: Was», over, with the tags «Pottery 7» and «Weaving 7».
- «AC-1: Untagged», coming up, with no tags.

Choosing a tag together with who can sign up is in [SITE-04](SITE-04-guest-filter.md), and the tags on the event page, each leading here, in [STU-15](STU-15-tags.md) AC-6.

## AC-1: Tags of events coming up

The front page SHALL offer «All» and a filter for each tag of the events coming up or going on, and none for tags found only on events that are over.

**Test**

- **Given** the events
- **When** you open the front page
- **Then** «Filter by tag» has «All» and «#Pottery 7», and no «#Weaving 7»

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-2: A tag filters the upcoming events

WHEN a tag is chosen, the front page SHALL show only the upcoming events with that tag, and mark the tag as chosen. The past events are not filtered.

**Test**

- **Given** the front page
- **When** you click «#Pottery 7»
- **Then** it is marked as chosen, «AC-1: Coming» shows under «Upcoming events» and «AC-1: Untagged» doesn't, and «AC-1: Was» and every other past event show under «Past events»

**Automated:** `packages/app/test/frontPage.test.ts`, `packages/app/e2e/specs/tags.spec.ts`

## AC-3: The tag is kept in the address

The front page SHALL keep the chosen tag in its address, so that opening that address shows the same filtered upcoming events, for a tag only on past events too.

**Test**

- **Given** «#Pottery 7» chosen
- **When** you copy the address, ending in `?tag=Pottery+7`, and open it in a new window
- **Then** the same tag is chosen, with the same lists
- **When** you open http://localhost:5173/?tag=Weaving%207
- **Then** «#Weaving 7» is marked as chosen, «Upcoming events» says «No upcoming events found in this category 😭», and «AC-1: Was» shows under «Past events»

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-4: Choosing it again, or All, removes it

WHEN the chosen tag or «All» is clicked, the front page SHALL remove the tag and show every event again.

**Test**

- **Given** «#Pottery 7» chosen
- **When** you click «#Pottery 7» again
- **Then** no tag is chosen, «All» is marked, and all events show
- **When** you choose «#Pottery 7», then click «All»
- **Then** the same

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-5: A tag in any case

WHEN a tag is given in the address in other capitals than it is written with, the front page SHALL choose the tag as written.

**Test**

- **Given** the events
- **When** you open http://localhost:5173/?tag=pottery%207
- **Then** «#Pottery 7» is marked as chosen, and «AC-1: Coming» and «AC-1: Was» show

**Automated:** none

## AC-6: Nothing tagged coming up

IF no event with the chosen tag is coming up, THEN the front page SHALL say «No upcoming events found in this category 😭» under «Upcoming events».

**Test**

- **Given** the events
- **When** you open http://localhost:5173/?tag=Weaving%207
- **Then** «Upcoming events» says «No upcoming events found in this category 😭»

**Automated:** `packages/app/e2e/specs/tags.spec.ts` (with a guest filter chosen beside the tag)
