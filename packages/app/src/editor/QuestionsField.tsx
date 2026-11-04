import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { EventContent, Question } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useMemo, useSyncExternalStore } from "react";
import { Button } from "../components/Button.tsx";
import inputStyles from "../components/Input.module.css";
import { Input } from "../components/Input.tsx";
import styles from "./QuestionsField.module.css";

// The questions asked of everyone signing up. Texts are Automerge text,
// merged as people type; ids and types are ImmutableStrings. Questions are
// found by id when changed, so edits land on the right one even when
// others add, remove or move questions meanwhile.

type QuestionType = Question["type"];

const typeLabels: Record<QuestionType, () => string> = {
  text: m.editor_q_written,
  checkbox: m.editor_q_checkbox,
  choice: m.editor_q_choice,
};

type Draft = {
  questions: Array<{
    id: unknown;
    type: unknown;
    text: string;
    label?: string;
    required: boolean;
    options: Array<{ id: unknown; text: string }>;
  }>;
};

const newOption = () => ({
  id: new A.ImmutableString(crypto.randomUUID()),
  text: "",
});

/** The draft's questions, updated as they change. */
const useQuestions = (handle: DocHandle<EventContent>) => {
  const key = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => JSON.stringify(handle.doc().questions ?? []),
  );
  return useMemo(() => JSON.parse(key) as ReadonlyArray<Question>, [key]);
};

export function QuestionsField(props: {
  readonly handle: DocHandle<EventContent>;
}) {
  const { handle } = props;
  const questions = useQuestions(handle);

  /** Changes the question with that id, if it's still there. */
  const change = (id: string, edit: (draft: Draft, index: number) => void) =>
    handle.change((doc) => {
      const draft = doc as unknown as Draft;
      const index = draft.questions.findIndex(
        (question) => String(question.id) === id,
      );
      if (index !== -1) edit(draft, index);
    });

  const add = () =>
    handle.change((doc) => {
      (doc as unknown as Draft).questions.push({
        id: new A.ImmutableString(crypto.randomUUID()),
        type: new A.ImmutableString("text"),
        text: "",
        required: false,
        options: [],
      });
    });

  const setType = (id: string, type: QuestionType) =>
    change(id, (draft, index) => {
      const question = draft.questions[index];
      if (question === undefined) return;
      question.type = new A.ImmutableString(type);
      if (type !== "choice") question.options.splice(0);
      while (type === "choice" && question.options.length < 2) {
        question.options.push(newOption());
      }
    });

  /** Moves a question up or down, as a copy: lists can't move items. */
  const move = (id: string, by: -1 | 1) =>
    change(id, (draft, index) => {
      const question = draft.questions[index];
      const to = index + by;
      if (question === undefined || to < 0 || to >= draft.questions.length) {
        return;
      }
      const copy = {
        id: new A.ImmutableString(String(question.id)),
        type: new A.ImmutableString(String(question.type)),
        text: question.text.toString(),
        ...(question.label === undefined
          ? {}
          : { label: question.label.toString() }),
        required: question.required,
        options: question.options.map((option) => ({
          id: new A.ImmutableString(String(option.id)),
          text: option.text.toString(),
        })),
      };
      draft.questions.splice(index, 1);
      draft.questions.splice(to, 0, copy);
    });

  return (
    <div className={styles.questions}>
      {questions.length === 0 ? (
        <p className={styles.empty}>{m.editor_q_empty()}</p>
      ) : (
        <ol className={styles.list}>
          {questions.map((question, index) => {
            const n = index + 1;
            return (
              <li key={question.id} className={styles.question}>
                <div className={styles.row}>
                  <select
                    aria-label={m.editor_q_type({ n })}
                    className={inputStyles.input}
                    value={question.type}
                    onChange={(event) =>
                      setType(
                        question.id,
                        event.currentTarget.value as QuestionType,
                      )
                    }
                  >
                    {Object.entries(typeLabels).map(([type, label]) => (
                      <option key={type} value={type}>
                        {label()}
                      </option>
                    ))}
                  </select>
                  <label className={styles.required}>
                    <input
                      type="checkbox"
                      checked={question.required}
                      onChange={(event) => {
                        const required = event.currentTarget.checked;
                        change(question.id, (draft, at) => {
                          const target = draft.questions[at];
                          if (target !== undefined) target.required = required;
                        });
                      }}
                    />
                    {question.type === "checkbox"
                      ? m.editor_q_must_tick()
                      : m.editor_q_required()}
                  </label>
                  <span className={styles.actions}>
                    <Button
                      variant="ghost"
                      aria-label={m.editor_q_up({ n })}
                      disabled={index === 0}
                      onClick={() => move(question.id, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={m.editor_q_down({ n })}
                      disabled={index === questions.length - 1}
                      onClick={() => move(question.id, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={m.editor_q_remove({ n })}
                      onClick={() =>
                        change(question.id, (draft, at) => {
                          draft.questions.splice(at, 1);
                        })
                      }
                    >
                      {m.common_remove()}
                    </Button>
                  </span>
                </div>
                <Input
                  aria-label={m.editor_q_name({ n })}
                  className={inputStyles.input}
                  placeholder={
                    question.type === "checkbox"
                      ? m.editor_q_tick_placeholder()
                      : m.editor_q_placeholder()
                  }
                  value={question.text}
                  onChange={(event) => {
                    const text = event.currentTarget.value;
                    change(question.id, (draft, at) =>
                      A.updateText(draft, ["questions", at, "text"], text),
                    );
                  }}
                />
                {question.type !== "checkbox" ? null : (
                  <Input
                    aria-label={m.editor_q_label({ n })}
                    className={inputStyles.input}
                    placeholder={m.editor_q_label_placeholder()}
                    value={question.label ?? ""}
                    onChange={(event) => {
                      const text = event.currentTarget.value;
                      change(question.id, (draft, at) => {
                        const target = draft.questions[at];
                        if (target === undefined) return;
                        // Questions made before labels have no text to edit.
                        if (target.label === undefined) target.label = text;
                        else
                          A.updateText(draft, ["questions", at, "label"], text);
                      });
                    }}
                  />
                )}
                {question.type !== "choice" ? null : (
                  <Options
                    n={n}
                    question={question}
                    change={(edit) => change(question.id, edit)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <Button onClick={add}>{m.editor_q_add()}</Button>
      </div>
    </div>
  );
}

/** A choice question's options. */
function Options(props: {
  /** The question's number. */
  readonly n: number;
  readonly question: Question;
  readonly change: (edit: (draft: Draft, index: number) => void) => void;
}) {
  const { n, question, change } = props;

  /** Changes the option with that id, if it's still there. */
  const changeOption = (
    id: string,
    edit: (
      options: Draft["questions"][number]["options"],
      at: number,
      path: Array<A.Prop>,
    ) => void,
  ) =>
    change((draft, index) => {
      const options = draft.questions[index]?.options;
      const at = options?.findIndex((option) => String(option.id) === id);
      if (options === undefined || at === undefined || at === -1) return;
      edit(options, at, ["questions", index, "options", at]);
    });

  return (
    <ul className={styles.options}>
      {question.options.map((option, index) => (
        <li key={option.id} className={styles.option}>
          <Input
            aria-label={m.editor_q_option({ n, option: index + 1 })}
            className={inputStyles.input}
            placeholder={m.editor_q_option_placeholder({ option: index + 1 })}
            value={option.text}
            onChange={(event) => {
              const text = event.currentTarget.value;
              change((draft, at) => {
                const options = draft.questions[at]?.options;
                const optionAt = options?.findIndex(
                  (each) => String(each.id) === option.id,
                );
                if (optionAt === undefined || optionAt === -1) return;
                A.updateText(
                  draft,
                  ["questions", at, "options", optionAt, "text"],
                  text,
                );
              });
            }}
          />
          <Button
            variant="ghost"
            aria-label={m.editor_q_option_remove({ n, option: index + 1 })}
            disabled={question.options.length <= 2}
            onClick={() =>
              changeOption(option.id, (options, at) => options.splice(at, 1))
            }
          >
            {m.common_remove()}
          </Button>
        </li>
      ))}
      <li>
        <Button
          variant="ghost"
          onClick={() =>
            change((draft, index) => {
              draft.questions[index]?.options.push(newOption());
            })
          }
        >
          {m.editor_q_option_add()}
        </Button>
      </li>
    </ul>
  );
}
