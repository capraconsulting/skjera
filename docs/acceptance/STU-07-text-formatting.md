# STU-07: The event text: formatting and links

An event's **Body** can have headings, bold and italic text, lists and links, made from its toolbar or by typing as in Markdown.

**Events:** in team «STU-07: The event text: formatting and links», one public event, «AC-1 to AC-5: Formatting», with a time and a place.

## AC-1: Formatting from the toolbar

The body's toolbar SHALL make selected text bold or italic, and the line it is on a heading, a bulleted list or a numbered list.

**Test**

- **Given** the event open in the studio, with a few lines in **Body**
- **When** you select text and click **B** (tooltip «Bold») and **I** (tooltip «Italic»)
- **And** you put the cursor in a line and click **H** («Heading»), **•** («Bulleted list») and **1.** («Numbered list»), one line each
- **Then** each takes effect, and clicking a button again takes it off

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`

## AC-2: Formatting by typing

WHEN an organiser types `## `, `### `, `- `, `* ` or `1. ` at the start of a line in the body, the editor SHALL make the line a heading, a smaller heading, a bulleted list or a numbered list.

**Test**

- **Given** the event open in the studio
- **When** you start new lines in **Body** with each of `## `, `### `, `- ` and `1. `
- **Then** the first two become headings, the next a bulleted list and the last a numbered list, without the characters typed

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`

## AC-3: Linking selected text

WHEN an organiser selects text in the body and clicks **Link**, the editor SHALL ask for an address and link the text to it, and SHALL offer **Link** only while text is selected.

**Test**

- **Given** the event open in the studio
- **When** you look at **Link** with nothing selected
- **And** you select a word, click **Link**, write `https://example.com` in **Link address** and click **Add link**
- **Then** **Link** is disabled with nothing selected, and the word becomes a link

**Automated:** `packages/app/e2e/specs/site/site.spec.ts`

## AC-4: Only web and email addresses

IF a link's address isn't a web or email address, THEN the editor SHALL refuse it with «Enter a web address, like https://example.com».

**Test**

- **Given** a word selected, and the **Add link** dialog open
- **When** you write `ftp://example.com` and click **Add link**
- **And** you write `mailto:bob@example.com` instead
- **Then** the first is refused with «Enter a web address, like https://example.com», and the second is linked

**Automated:** `packages/app/test/editor/richTextLinks.test.ts`, `packages/app/e2e/specs/site/siteStudioLinks.spec.ts`

## AC-5: Editing and removing a link

The editor SHALL let an organiser change a link's address, and remove the link while keeping its text.

**Test**

- **Given** the link from AC-3
- **When** you select the linked word and click **Link**
- **And** you change the address and click **Save link**, then open it again and click **Remove link**
- **Then** the dialog is titled «Edit link» with the address filled in; the address changes, and then the word stays without a link

**Automated:** `packages/app/e2e/specs/site/siteStudioLinks.spec.ts`
