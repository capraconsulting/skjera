import type { CancellingNotice, PublishingNotice } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";

export const publishQuestion = (notice: PublishingNotice): string | null => {
  if (notice.told === 0) return null;
  if (notice.moved && notice.newPlace) {
    return m.studio_confirm_move_and_place({ count: notice.told });
  }
  if (notice.moved) return m.studio_confirm_move({ count: notice.told });
  if (notice.newPlace) {
    return m.studio_confirm_new_place({ count: notice.told });
  }
  return m.studio_confirm_publish_emailed({ count: notice.told });
};

export const unpublishQuestion = (notice: CancellingNotice): string =>
  notice.told === 0
    ? m.studio_confirm_unpublish()
    : m.studio_confirm_unpublish_cancels({ count: notice.told });

export const deleteQuestion = (notice: CancellingNotice): string =>
  notice.told === 0
    ? m.studio_confirm_delete()
    : m.studio_confirm_delete_cancels({ count: notice.told });

type Changed<N> = { readonly _tag: "NoticeChanged"; readonly notice: N };

export const confirmNotice = async <N>(
  first: N,
  question: (notice: N) => string | null,
  ask: (question: string) => Promise<boolean>,
  act: (confirmed: N) => Promise<undefined | Changed<N>>,
): Promise<boolean> => {
  let notice = first;
  for (;;) {
    const text = question(notice);
    if (text !== null && !(await ask(text))) return false;
    const result = await act(notice);
    if (result === undefined) return true;
    notice = result.notice;
  }
};
