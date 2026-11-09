import { type CancellingNotice, PublishingNotice } from "../../Model.ts";
import { recipients, type Signup } from "../../notices/Notifications.ts";

export interface WhenAndWhere {
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly place: string | null;
}

export const changeToTell = (
  before: WhenAndWhere | undefined,
  after: WhenAndWhere | undefined,
) => {
  if (before === undefined || after === undefined) return null;
  const moved =
    before.starts_at.getTime() !== after.starts_at.getTime() ||
    before.ends_at.getTime() !== after.ends_at.getTime();
  const newPlace = before.place !== after.place;
  return moved || newPlace ? { moved, newPlace } : null;
};

export const publishingAnswer = (
  before: WhenAndWhere | undefined,
  after: WhenAndWhere | undefined,
  signups: ReadonlyArray<Signup>,
) => {
  const change = changeToTell(before, after);
  return new PublishingNotice({
    moved: change?.moved ?? false,
    newPlace: change?.newPlace ?? false,
    told: change === null ? 0 : recipients(signups).length,
  });
};

export const samePublishingNotice = (
  a: PublishingNotice,
  b: PublishingNotice,
) => a.moved === b.moved && a.newPlace === b.newPlace && a.told === b.told;

export const sameCancellingNotice = (
  a: CancellingNotice,
  b: CancellingNotice,
) => a.told === b.told;
