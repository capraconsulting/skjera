# STU-09: Cover image

An event can have a cover image, with a description for those who can't see it. The event page shows it.

**Events:** in team «STU-09: Cover image», a public event «AC-1 to AC-5: Cover», next month, with a time and a place. Have two small images at hand.

## AC-1: Choosing, dropping or pasting a cover

The studio SHALL let an organiser give an event a cover image by choosing a file, or by dropping or pasting an image onto the cover field.

**Test**

- **Given** «AC-1 to AC-5: Cover» open in the studio
- **When** you click **Choose cover image** under **Cover image** and choose an image
- **And** you drop the other image onto the cover, then copy an image, press Tab until **Replace cover image** is focused, and paste
- **Then** the cover shows each image in turn, and the button now says **Replace cover image**

**Automated:** `packages/app/e2e/specs/images.spec.ts`

## AC-2: A description for the cover

WHILE an event has a cover image, the studio SHALL offer a field to describe it, saying «Describe the image for those who can't see it.»

**Test**

- **Given** the event with a cover from AC-1
- **When** you write «A full room» in the description under the image
- **Then** it stays as written, under the hint «Describe the image for those who can't see it.»

**Automated:** `packages/app/e2e/specs/images.spec.ts`

## AC-3: A new image keeps the description

WHEN a cover image is replaced, the studio SHALL keep its description.

**Test**

- **Given** the cover described as «A full room»
- **When** you click **Replace cover image** and choose the other image
- **Then** the new image shows, still described as «A full room»

**Automated:** `packages/app/e2e/specs/images.spec.ts`

## AC-4: The event page shows the cover

The event page SHALL show the event's cover image, with its description as its alternative text.

**Test**

- **Given** the event with its described cover
- **When** you click **Publish** and open the event on the site
- **Then** the cover shows, with «A full room» as its alternative text

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/documents/test/events/publishing.test.ts`

## AC-5: Removing the cover

WHEN an organiser clicks **Remove cover image**, the studio SHALL take off the image and its description, and the event page SHALL show no cover once it is published again.

**Test**

- **Given** the published event with its cover
- **When** you click **Remove cover image**, then **Publish**
- **And** you choose a cover again
- **Then** the site shows the event with no image, and the new cover's description is empty

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/documents/test/events/publishing.test.ts`

## AC-6: Only uploaded images

IF a cover's address isn't an image uploaded to Skjera, THEN Skjera SHALL refuse the change.

**Automated only:** the studio only sets covers it has uploaded. `packages/documents/test/events/publishing.test.ts`
