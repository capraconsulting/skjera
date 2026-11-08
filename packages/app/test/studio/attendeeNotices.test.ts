import type { CancellingNotice, PublishingNotice } from "@skjera/documents/api";
import { describe, expect, it, vi } from "vitest";
import {
  confirmNotice,
  deleteQuestion,
  publishQuestion,
  unpublishQuestion,
} from "../../src/routes/studio/attendance/attendeeNotices.ts";

describe("attendee notices", () => {
  it("builds publishing and cancelling questions only from the server answer (AC-1)", () => {
    const none = { moved: false, newPlace: false, told: 0 } as PublishingNotice;
    expect(publishQuestion(none)).toBeNull();
    expect(publishQuestion({ ...none, moved: true, told: 2 })).toContain("2");
    expect(publishQuestion({ ...none, newPlace: true, told: 2 })).toContain(
      "2",
    );
    expect(
      publishQuestion({ ...none, moved: true, newPlace: true, told: 2 }),
    ).toContain("2");
    expect(publishQuestion({ ...none, told: 2 })).toBe(
      "Publish the changes? The 2 people signed up are emailed about them.",
    );
    expect(unpublishQuestion({ told: 0 } as CancellingNotice)).not.toContain(
      "0",
    );
    expect(unpublishQuestion({ told: 2 } as CancellingNotice)).toContain("2");
    expect(deleteQuestion({ told: 0 } as CancellingNotice)).not.toContain("0");
    expect(deleteQuestion({ told: 2 } as CancellingNotice)).toContain("2");
  });

  it("asks again before retrying an action whose answer changed (AC-1)", async () => {
    const first = { told: 1 } as CancellingNotice;
    const changed = { told: 2 } as CancellingNotice;
    const ask = vi.fn(() => true);
    const act = vi
      .fn()
      .mockResolvedValueOnce({ _tag: "NoticeChanged", notice: changed })
      .mockResolvedValueOnce(undefined);

    await confirmNotice(first, ({ told }) => String(told), ask, act);

    expect(ask).toHaveBeenNthCalledWith(1, "1");
    expect(ask).toHaveBeenNthCalledWith(2, "2");
    expect(act).toHaveBeenNthCalledWith(1, first);
    expect(act).toHaveBeenNthCalledWith(2, changed);
  });
});
