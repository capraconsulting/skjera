# ACC-06: Language: English, Bokmål and Nynorsk

The site and the studio are in English, Norwegian Bokmål and Nynorsk. Each visitor picks theirs in the header; without a choice, the site's own language is used. What organisers write stays in the language they wrote it in.

**Events:** in team «ACC-06: Language: English, Bokmål and Nynorsk», one public event open to guests, «AC-2 to AC-4: Written in English», with a time next month.

## AC-1: A language picker in the header

The header SHALL have a language picker, with English, Bokmål and Nynorsk, on the site and in the studio.

**Test**

- **Given** http://localhost:5173 in a private window, and alice logged into the studio
- **When** you open **Language**, the globe in the header, in each
- **Then** both offer **English**, **Bokmål** and **Nynorsk**

**Automated:** `packages/app/e2e/specs/tooling/language.spec.ts`

## AC-2: The whole interface switches, the content stays

WHEN a visitor picks a language, Skjera SHALL show the page again with all its words and dates in that language, and the event's own title and text as they were written.

**Test**

- **Given** «AC-2 to AC-4: Written in English» open in a private window
- **When** you pick **Bokmål** in the header
- **Then** the sign-up box says «Ingen har meldt seg på ennå.» and «Påmeldingen stenger …» with the day and month in Bokmål
- **And** the title is still «AC-2 to AC-4: Written in English»

**Automated:** `packages/app/e2e/specs/tooling/language.spec.ts`

## AC-3: The studio switches too, its calendar included

WHEN an organiser picks a language in the studio, Skjera SHALL show the studio in it, the date picker included.

**Test**

- **Given** alice logged into the studio, with «AC-2 to AC-4: Written in English» open
- **When** she picks **Nynorsk** in the header
- **Then** the editor shows **Tittel**, «Lagra» and **Slett**
- **When** she clicks **Startdato**
- **Then** the calendar's months and buttons are in Nynorsk, such as «neste månad»

**Automated:** `packages/app/e2e/specs/tooling/language.spec.ts`

## AC-4: Refusals in the chosen language

IF Skjera refuses what a visitor sends, THEN it SHALL say why in the language the visitor picked.

**Test**

- **Given** a guest signed up to «AC-2 to AC-4: Written in English» with an email address
- **And** every private window closed, and the event open in a new one, in **Bokmål**
- **When** you sign up with **Navnet ditt** and the same address in **E-postadressen din**, and click **Meld meg på**
- **Then** it says «Den e-postadressen er allerede påmeldt dette arrangementet»

**Automated:** `packages/app/e2e/specs/tooling/language.spec.ts`, `packages/documents/test/api/Problems.test.ts`

## AC-5: The choice is remembered

WHEN a visitor who has picked a language comes back to the site in the same browser, Skjera SHALL show it in that language.

**Test**

- **Given** a private window where you picked **Bokmål**
- **When** you reload the page, and open another page of the site
- **Then** both are in Bokmål, and the picker, now **Språk**, shows **Bokmål**

**Automated:** `packages/app/e2e/specs/tooling/language.spec.ts`

## AC-6: Without a choice, the site's language

WHILE a visitor has not picked a language, Skjera SHALL show the site in the language set in `SITE_LOCALE`.

**Test**

- **Given** `SITE_LOCALE = "nn"` under `[env]` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you close every private window, and open http://localhost:5173 in a new one
- **Then** the site is in Nynorsk
- **And** remove the line from `mise.local.toml` and restart `pnpm dev` afterwards

**Automated:** `packages/documents/test/Model.test.ts`, `packages/app/test/structure/i18n.test.ts`

## AC-7: Every word in every language

Skjera SHALL have every message of the interface in English, Bokmål and Nynorsk.

**Automated only:** a person can't see every message. `packages/i18n/test/messages.test.ts`, `packages/documents/test/api/Problems.test.ts`
