# STU-08: Images in the event text

Images can be put in an event's **Body**, from the toolbar or by pasting or dropping them, each with a description for those who can't see it, a caption, a placement and a size.

**Events:** in team «STU-08: Images in the event text», one public event, «AC-1 to AC-13: Images», with a time and a place. Have at hand a small PNG, a PNG of at least 11 MB, and a text file renamed to `not-an-image.png`.

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

WHILE an image in the body is selected, the toolbar SHALL offer to describe it, with a button that shows **Alt text** and is named «Alt text: describe the image» for screen readers.

**Test**

- **Given** a pasted image from AC-4, selected
- **When** you click **Alt text** (tooltip «Alt text: describe the image»), write «A screenshot» in **Description** and click **Save**
- **And** you click **Publish**, and open the event on the site
- **Then** the site's image has «A screenshot» as its alternative text

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/i18n/test/messages.test.ts`

## AC-6: A caption, a placement and a size for each image

The **Add image** dialog and the dialog **Alt text** opens SHALL let an organiser give an image in **Body** a **Caption**, a **Placement** («Full width», «Float left», «Float right» or «Centred») and a **Size** («Small», «Medium» or «Large»), and the choices SHALL be kept in the event. The email texts' images have none of them.

**Test**

- **Given** the event open in the studio, with the cursor in **Body**
- **When** you click **Image**, choose the small PNG, write «A caption» in **Caption**, choose «Float left» in **Placement** and «Small» in **Size**, and click **Add image**
- **And** you reload the page, select the image and click **Alt text**
- **Then** the dialog shows «A caption», «Float left» and «Small»
- **And** the **Image** dialog of an email's text, opened from **Emails**, has no **Caption**, **Placement** or **Size**

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/app/test/richTextImages.test.ts`

## AC-7: Full width and medium unless chosen

WHEN no placement or size is chosen for an image, the event page SHALL show it full width at medium size. A new image, whether it comes from the toolbar, a paste or a drop, starts on «Full width» and «Medium».

**Test**

- **Given** the event open in the studio
- **When** you drag the small PNG into **Body**, and click **Publish**
- **Then** the dialog of **Alt text** on that image shows «Full width» and «Medium»
- **And** on the event page the image is as wide as the text, at most 36 rem

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/app/test/richTextImages.test.ts`

## AC-8: Three sizes

WHERE «Small», «Medium» or «Large» is chosen, the event page SHALL show the image at most 24, 36 or 48 rem wide.

**Test**

- **Given** an image in the body with **Placement** «Full width»
- **When** you set **Size** to «Small», «Medium» and «Large» in turn, publish, and open the event on a wide screen
- **Then** the image is at most 24, 36 and 48 rem wide

**Automated:** none (how wide an image is, is the stylesheet's)

## AC-9: Floated left or right

WHERE an image floats left or right and the screen is 480 px wide or more, the event page SHALL show it at 38% of the text's width, at most 9, 12 or 16 rem for «Small», «Medium» and «Large», with the text flowing around it. On a narrower screen it is shown full width, at most as wide as its size.

**Test**

- **Given** an image with a long text around it, set to «Float left» and then «Float right»
- **When** you open the event on a screen 480 px wide or more
- **Then** the image is at the left and then the right, and the text flows around it, and the sign-up box below the text never wraps around it
- **And** on a screen narrower than 480 px the image is full width, with no text beside it

**Automated:** none (layout)

## AC-10: Centred

WHERE «Centred» is chosen, the event page SHALL show the image in the middle of the text, with no text beside it.

**Test**

- **Given** an image set to «Centred»
- **When** you open the event on the site
- **Then** the image is in the middle of the text, with no text beside it

**Automated:** none (layout)

## AC-11: A caption under the image

WHERE a caption is given, the event page SHALL show it under the image. A caption of only spaces is no caption.

**Test**

- **Given** an image with the caption «A caption»
- **When** you publish, and open the event on the site
- **Then** «A caption» is under the image

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/app/test/richTextImages.test.ts`

## AC-12: An alternative text when there is none

IF an image has no description, THEN the event page SHALL give it «Illustration in the event description» as its alternative text, in the page's language (Bokmål: «Illustrasjon i arrangementsbeskrivelsen»).

**Test**

- **Given** an image dropped into the body and never described
- **When** you publish, and open the event on the site
- **Then** the site's image has «Illustration in the event description» as its alternative text

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/app/test/richTextImages.test.ts`

## AC-13: Older images look as before

WHEN an event whose images were placed before there were choices is shown, the event page SHALL show them as they were: a plain image at its own size, up to the text's width. An older image changes only once an organiser changes one of its choices; saving its dialog with «Full width», «Medium» and no caption leaves it as it was.

**Test**

- **Given** an event published before the choices existed, with an image in its body
- **When** you open the event on the site, and in the studio open **Alt text** on the image and click **Save** without changing anything
- **Then** the image looks the same in both cases

**Automated:** `packages/app/test/richTextImages.test.ts`
