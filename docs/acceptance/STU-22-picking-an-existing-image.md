# STU-22: Picking an existing image

Wherever the studio lets an organiser choose an image, the organiser can pick one already in Skjera instead of uploading it again: for the event's cover and for an image in a text (the body and the email texts). The list holds every image uploaded to Skjera, whichever event it was uploaded for, as small pictures with the newest first.

**Readings:**

- Team logos, and images pasted or dropped into a text, are not covered: a logo is picked in team settings, and a pasted or dropped image brings a file of its own.
- The list is the images in Skjera's image storage, so it includes images no event shows any more.
- A page holds 30 pictures; the next page is loaded when the end of the list is reached.

**Events:** in team «STU-22: Picking an image already in Skjera», a public event «AC-1 to AC-4: Pick an image», next month, with a time and a place. Have an image at hand, and a second one to upload in AC-4.

## AC-1: The choice beside uploading

Wherever the studio lets the organiser choose an image, it SHALL offer to pick an image already in Skjera, beside uploading a new one.

**Test**

- **Given** «AC-1 to AC-4: Pick an image» open in the studio
- **Then** **Pick an existing image** is shown under **Cover image**, beside **Choose cover image**
- **When** you choose a cover image
- **Then** **Pick an existing image** is still there, beside **Replace cover image**
- **When** you click in **Body** and click **Image**
- **Then** the dialog shows **Pick an existing image** beside the file to upload
- **When** you cancel it, open **Emails**, click in the text of one email and click **Image**
- **Then** that dialog shows **Pick an existing image** too

**Automated:** `packages/app/e2e/specs/studio/images.spec.ts`

## AC-2: Every image, newest first

WHEN the organiser opens the list, the studio SHALL show all images uploaded to Skjera, from every event, newest first.

**Test**

- **Given** «AC-1 to AC-4: Pick an image» open in the studio, and an image you upload now as its cover
- **When** you click **Pick an existing image** under **Cover image**
- **Then** the list **Images in Skjera** opens with small pictures, and the image you just uploaded is the first
- **And** the covers of the other events in the test data are further down, among images uploaded for other events

**Automated:** `packages/documents/test/events/Images.test.ts`

## AC-3: More as you scroll

WHILE the organiser scrolls the list, the studio SHALL load more images until all have been shown.

**Test**

- **Given** more than 30 images uploaded to Skjera (upload more by choosing a cover image until there are)
- **When** you open the list and scroll to its end
- **Then** more pictures appear, and when you scroll on, the rest come, until every image has been shown

**Automated:** `packages/app/e2e/specs/studio/images.spec.ts`, `packages/documents/test/events/Images.test.ts`

## AC-4: Picking without uploading

WHEN the organiser picks an image from the list, the studio SHALL use it for the event without uploading it again.

**Test**

- **Given** «AC-1 to AC-4: Pick an image» open in the studio
- **When** you open the list from **Cover image** and click a picture
- **Then** the list closes and the cover shows that image
- **When** you click in **Body**, click **Image**, click **Pick an existing image** and click a picture
- **Then** the list closes, the **Image** dialog is still open and shows a small picture of it
- **When** you write a description and click **Add image**
- **Then** the body shows that image with the description
- **When** you open **Image** again, choose a file, then pick an image from the list and click **Add image**
- **Then** the picked image is the one added, not the file
- **And** the browser's network list shows no upload when you pick

**Automated:** `packages/app/e2e/specs/studio/images.spec.ts`

## AC-5: The list needs a login

IF someone not logged in asks for the list, THEN Skjera SHALL refuse.

**Automated only:** the studio only asks for the list when logged in. `packages/documents/test/events/Images.test.ts`
