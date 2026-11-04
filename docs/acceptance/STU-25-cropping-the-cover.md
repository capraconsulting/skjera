# STU-25: Cropping the cover

An organiser can crop an event's cover image and choose its focal point. The crop is the part of the picture to use. The focal point is the point of the picture that must stay in view where the cover is cut to fit a shape, such as the front page cards, so a face or a logo is not cut away.

**Readings:**

- The embed page shows no cover, so there is nothing to crop there.
- The shared image on LinkedIn and Slack is the cropped part. Skjera does not cut it to a shape: LinkedIn and Slack do that themselves, and a focal point cannot steer them.
- The cropped part is an image of its own, uploaded when you click **Apply**, so it is listed in **Pick an existing image** with the others. The picture you started from is never changed.
- A PNG or GIF picture gives a PNG part, which keeps its see-through parts. Any other picture gives a JPEG part, on a white background. A GIF that moves gives a part that is still.
- The focal point stays in view, as far into the box as it is into the part shown. It does not put the point in the middle of the box.
- The test pictures in the test data are one colour, so a crop shows no difference on them. Have a photo at hand, with something near one edge that you want to keep in view.

**Events:** in team «STU-25: Cropping the cover», a public event «AC-1 to AC-9: Cover to crop», next week, with a time and a place and no cover. Have a photo at hand, and a second picture for AC-5.

## AC-1: Crop and focal point in the studio

The studio SHALL let the organiser crop the cover image and set its focal point.

**Test**

- **Given** «AC-1 to AC-9: Cover to crop» open in the studio, with your photo chosen as its cover
- **Then** **Crop** and **Focal point** are shown beside **Replace cover image**, and **Reset crop and focal point** is not
- **When** you click **Crop**, drag a frame over the part of the photo you want, drag inside the frame to move it, and click **Apply**
- **Then** the cover field shows that part instead of the whole photo, and **Reset crop and focal point** appears
- **When** you click **Crop** again and focus the frame, press the arrow keys, then Shift with the arrow keys
- **Then** the frame moves, then changes its size, and never leaves the photo or becomes smaller than 5 % of its width or height
- **When** you click **Focal point**, click the point that must stay in view and click **Apply**
- **Then** the dialog closes and the point is kept

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/app/test/cropFrame.test.ts`, `packages/app/test/coverEdits.test.ts`, `packages/documents/test/Model.test.ts`, `packages/documents/test/events/publishing.test.ts`

## AC-2: The cropped part is shown

WHERE a crop is set, Skjera SHALL show only the cropped part of the cover wherever the cover is shown.

**Test**

- **Given** the event with the crop from AC-1, published
- **Then** the event page, the preview in the studio and the event's card on the front page, once the event is over, show the cropped part and not the whole photo
- **And** a link to the event pasted into Slack, or into a LinkedIn post, shows the cropped part
- **And** the embed page shows no cover, as before

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/documents/test/Model.test.ts`, `packages/documents/test/events/preview.test.ts`, `packages/documents/test/site/Sharing.test.ts`, `packages/documents/test/notices/SlackChannel.test.ts`

## AC-3: Cut around the focal point

WHERE a focal point is set and the cover is cut to fit a shape, Skjera SHALL cut it around the focal point.

**Test**

- **Given** the published event with a focal point near one edge of the photo
- **When** you open the event page at a wide window and at a narrow one, and look at its card on the front page once it is over
- **Then** in every shape, the point is still in view
- **When** you set the focal point to the other side of the photo, publish, and look again
- **Then** the cut follows it

**Automated:** `packages/documents/test/Model.test.ts`

## AC-4: Without a crop or a focal point

WHEN no crop or focal point is set, Skjera SHALL show the whole picture, cut around its centre, as before.

**Test**

- **Given** a cover without a crop and without a focal point, such as the covers of the other events in the test data
- **Then** the event page and the front page card show the whole picture, cut around its centre, as they did before cropping existed

**Automated:** `packages/documents/test/Model.test.ts`, `packages/documents/test/site/Sharing.test.ts`, `packages/documents/test/notices/SlackChannel.test.ts`, `packages/documents/test/events/publishing.test.ts`

## AC-5: A new picture starts over

WHEN the organiser chooses a new picture, the studio SHALL reset the crop and the focal point.

**Test**

- **Given** the event with a crop, a focal point and the description «A full room»
- **When** you choose another picture with **Replace cover image**, or drop one onto the cover, or paste one, or pick one with **Pick an existing image**
- **Then** the cover shows the whole new picture, **Reset crop and focal point** is gone, and the description is still «A full room»

**Automated:** `packages/app/test/coverEdits.test.ts`

## AC-6: Published with the other fields

WHILE a change to the crop or focal point is not published, the site SHALL show the cover as last published.

**Test**

- **Given** the published event with a crop
- **When** you change the crop or the focal point in the studio, without publishing
- **Then** the event page on the site still shows the cover as last published
- **When** you publish
- **Then** the event page shows the new crop

**Automated:** `packages/documents/test/events/publishing.test.ts`

## AC-7: The feature files describe it

The feature files in `docs/acceptance` SHALL describe the crop and the focal point.

**Automated only:** what a feature file says is read, not run. This file is the description, and `packages/server/test/testdata.test.ts` checks that the team and event it names are in the test data.

## AC-8: Resetting

WHEN the organiser resets the crop and the focal point, Skjera SHALL show the whole picture, cut around its centre.

**Test**

- **Given** the event with a crop and a focal point
- **When** you click **Reset crop and focal point**
- **Then** the cover field shows the whole photo again, and the button is gone
- **When** you publish
- **Then** the event page shows the whole photo, cut around its centre

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/app/test/coverEdits.test.ts`, `packages/documents/test/Model.test.ts`

## AC-9: The uploaded file is kept

WHEN a crop or focal point is set, Skjera SHALL keep the uploaded file unchanged.

**Test**

- **Given** the event with a crop
- **When** you reset the crop and look at the cover
- **Then** it is the photo you chose, exactly as before you cropped it
- **And** **Pick an existing image** lists the photo as well as the cropped part

**Automated:** `packages/app/test/coverEdits.test.ts`
