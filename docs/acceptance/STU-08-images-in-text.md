# STU-08: Images in the event text

Images can be put in an event's **Body**, from the toolbar or by pasting or dropping them, each with a description for those who can't see it.

**Events:** in team «STU-08: Images in the event text», one public event, «AC-1 to AC-5: Images», with a time and a place. Have at hand a small PNG, a PNG of at least 11 MB, and a text file renamed to `not-an-image.png`.

## AC-1: An image from the toolbar, with a description

The body's toolbar SHALL let an organiser upload an image with a description, and the event page SHALL show it with the description as its alternative text.

**Test**

- **Given** the event open in the studio, with the cursor in **Body**
- **When** you click **Image**, choose the small PNG, write «A pixel» in **Description** and click **Add image**
- **And** you click **Publish**, and open the event on the site
- **Then** the image is in the body in the studio and on the site, and the site's image has «A pixel» as its alternative text

**Automated:** `packages/app/e2e/specs/images.spec.ts`

## AC-2: Images only

IF a file isn't a PNG, JPEG, GIF, WebP or AVIF image, THEN Skjera SHALL refuse it with «Pick a PNG, JPEG, GIF, WebP or AVIF image».

**Test**

- **Given** the **Add image** dialog open
- **When** you choose `not-an-image.png` and click **Add image**
- **Then** the dialog says «Pick a PNG, JPEG, GIF, WebP or AVIF image», and no image is added

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/documents/test/events/Images.test.ts`

## AC-3: At most 10 MB

IF an image is larger than 10 MB, THEN Skjera SHALL refuse it with «Images can be at most 10 MB».

**Test**

- **Given** the **Add image** dialog open
- **When** you choose the PNG of more than 10 MB and click **Add image**
- **Then** the dialog says «Images can be at most 10 MB», and no image is added

**Automated:** none

## AC-4: Pasted or dropped images are uploaded

WHEN an image is pasted or dropped into the body, the editor SHALL upload it, put it where it was pasted or dropped, and select it so it can be described.

**Test**

- **Given** the event open in the studio
- **When** you copy an image and paste it into **Body**, and drag the small PNG from your files into **Body**
- **Then** each shows «Uploading image…» and then the image, selected, with **Alt text** in the toolbar

**Automated:** `packages/app/e2e/specs/images.spec.ts`

## AC-5: Describing an image afterwards

WHILE an image in the body is selected, the toolbar SHALL offer to describe it.

**Test**

- **Given** a pasted image from AC-4, selected
- **When** you click **Alt text** (tooltip «Describe image»), write «A screenshot» in **Description** and click **Save**
- **And** you click **Publish**, and open the event on the site
- **Then** the site's image has «A screenshot» as its alternative text

**Automated:** `packages/app/e2e/specs/images.spec.ts`
