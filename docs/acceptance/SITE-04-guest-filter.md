# SITE-04: Filter on who can sign up

The front page filters the events guests can sign up for, «Åpent for alle», from the others, «Kun interne».

**Events:** public events, some open to guests and some not, and at least one with a tag.

## AC-1: Two filters

The front page SHALL offer two filters: «Åpent for alle» for events guests can sign up for and «Kun interne» for events they can't; Nynorsk and English have words of their own.

**Test**

- **Given** the events
- **When** you open the front page
- **Then** «Filter by who can sign up» has «Open to all» and «Internal only»

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-2: A filter applies to every list

WHEN one of the two filters is chosen, the front page SHALL show only the events it names, in every list on the page.

**Test**

- **Given** the front page
- **When** you choose «Open to all»
- **Then** only events open to guests show, in the upcoming and the past events alike

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-3: At most one is chosen

WHEN the chosen filter is chosen again, or the other one is chosen, the front page SHALL remove the first, so that at most one is chosen.

**Test**

- **Given** «Open to all» chosen
- **When** you choose «Internal only»
- **Then** it replaces the first
- **When** you choose «Internal only» again
- **Then** no filter is chosen, and all events show

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-4: A filter and a tag together

WHILE one of the two filters and a tag are chosen, the front page SHALL show only events that match both.

**Test**

- **Given** the front page
- **When** you choose a filter and a tag
- **Then** only events that match both show

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-5: The filter is kept in the address

The front page SHALL keep the chosen filter in its address, so that opening that address shows the same filtered lists.

**Test**

- **Given** a filter chosen
- **When** you copy the address and open it in a new window
- **Then** the same filter is chosen, with the same lists

**Automated:** `packages/app/e2e/specs/tags.spec.ts`

## AC-6: The filters are named in every language

The two filters SHALL be named in English, Bokmål and Nynorsk, as the rest of the interface is.

**Test**

- **Given** the front page
- **When** you pick Bokmål, then Nynorsk, in the site's header
- **Then** the filters are named in each

**Automated:** `packages/app/e2e/specs/tags.spec.ts`, `packages/i18n/test/messages.test.ts`
