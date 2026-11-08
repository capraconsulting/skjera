import {
  type Answers,
  dietaryPreferenceLength,
  guestCompanyLength,
  guestJobTitleLength,
  guestPhoneLength,
  type Question,
  writtenAnswerLength,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { appPaths } from "@skjera/paths";
import { type InputHTMLAttributes, useId } from "react";
import { Link } from "react-router";
import { Input } from "../../../components/controls/Input.tsx";
import { currentSite } from "../../../i18n.ts";
import {
  checkboxWords,
  chosenOption,
  consentField,
  type GuestField,
  questionField,
  signupFields,
} from "../../../site/signupForm.ts";
import { attendStyles as styles } from "./Attend.tsx";

/** For bots: people never see it, and screen readers and the keyboard skip it. */
export const HoneypotInput = () => (
  <input
    name={signupFields.subject}
    hidden
    tabIndex={-1}
    autoComplete="off"
    aria-hidden="true"
  />
);

/** What someone told when signing up, to change it. */
export type Given = {
  readonly answers?: Answers | undefined;
  /** Follows online rather than in person; unknown for a new signup. */
  readonly online?: boolean | undefined;
  /** A guest's own. */
  readonly phone?: string | undefined;
  readonly company?: string | undefined;
};

/** Why guest inputs were refused, by the input's name. */
export type FieldMessages = Partial<Record<GuestField, string>>;

/**
 * One of a guest's inputs and, while it is refused, its message beneath,
 * which is also the input's description.
 */
export function GuestInput({
  name,
  messages,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly name: GuestField;
  readonly messages: FieldMessages;
}) {
  const messageId = useId();
  const message = messages[name];
  return (
    <div className={styles.field}>
      <Input
        {...props}
        name={name}
        aria-invalid={message === undefined ? undefined : true}
        aria-describedby={message === undefined ? undefined : messageId}
      />
      {message === undefined ? null : (
        <p id={messageId} className={styles.error}>
          {message}
        </p>
      )}
    </div>
  );
}

/** A guest's phone number and company, both optional; members aren't asked. */
export const GuestContactInputs = (props: {
  readonly given: Given;
  readonly messages: FieldMessages;
}) => (
  <div className={styles.fields}>
    <GuestInput
      name={signupFields.telephone}
      messages={props.messages}
      type="tel"
      autoComplete="tel"
      defaultValue={props.given.phone}
      aria-label={m.attend_your_phone()}
      placeholder={`${m.attend_your_phone()} ${m.attend_optional()}`}
      maxLength={guestPhoneLength}
    />
    <GuestInput
      name={signupFields.company}
      messages={props.messages}
      autoComplete="organization"
      defaultValue={props.given.company}
      aria-label={m.attend_your_company()}
      placeholder={`${m.attend_your_company()} ${m.attend_optional()}`}
      maxLength={guestCompanyLength}
    />
  </div>
);

/** A guest's job title, optional; asked on a sales event's form only. */
export const JobTitleInput = (props: { readonly messages: FieldMessages }) => (
  <div className={styles.fields}>
    <GuestInput
      name={signupFields.jobtitle}
      messages={props.messages}
      autoComplete="organization-title"
      aria-label={m.attend_your_job_title()}
      placeholder={`${m.attend_your_job_title()} ${m.attend_optional()}`}
      maxLength={guestJobTitleLength}
    />
  </div>
);

/** Where people read how their details are handled, under the words given. */
export function PrivacyLink(props: { readonly text: string }) {
  const { url } = currentSite().privacy;
  return url === undefined ? (
    <Link to={appPaths.privacy}>{props.text}</Link>
  ) : (
    <a href={url}>{props.text}</a>
  );
}

/**
 * The box a sales event's sign-up form asks invitations and the newsletter
 * with: optional and unticked, with a link to the privacy policy beside it.
 */
export const ConsentInput = () => (
  <>
    <label className={styles.check}>
      <input type="checkbox" name={consentField} />
      {m.attend_consent()}
    </label>
    <p className={styles.privacy}>
      <PrivacyLink text={m.attend_consent_privacy()} />
    </p>
  </>
);

/** Asked, optionally, of everyone signing up when the event serves food. */
export const DietaryInput = () => (
  <Input
    name={signupFields.dietary}
    aria-label={m.attend_dietary()}
    placeholder={`${m.attend_dietary()} ${m.attend_optional()}`}
    maxLength={dietaryPreferenceLength}
  />
);

/**
 * In person or online, picked by everyone signing up to a streamed event:
 * neither is chosen in advance.
 */
export function AttendanceInput(props: {
  readonly defaultOnline: boolean | undefined;
  /** No place is left in person. */
  readonly inPersonDisabled: boolean;
}) {
  return (
    <fieldset className={styles.choice}>
      <legend>{m.attend_how()}</legend>
      <label className={styles.check}>
        <input
          type="radio"
          name={signupFields.attendance}
          value="in-person"
          required
          disabled={props.inPersonDisabled}
          defaultChecked={props.defaultOnline === false}
        />
        {props.inPersonDisabled
          ? m.attend_in_person_full()
          : m.attend_in_person()}
      </label>
      <label className={styles.check}>
        <input
          type="radio"
          name={signupFields.attendance}
          value="online"
          required
          defaultChecked={props.defaultOnline === true}
        />
        {m.attend_online()}
      </label>
    </fieldset>
  );
}

/** The event's questions, as form fields. */
export function QuestionInputs(props: {
  readonly questions: ReadonlyArray<Question>;
  /** Answers given before, to start from. */
  readonly given?: Answers | undefined;
}) {
  const given = props.given ?? {};
  return props.questions.map((question) => {
    switch (question.type) {
      case "text":
        return (
          <div key={question.id} className={styles.question}>
            <label htmlFor={questionField(question)}>
              {question.text}
              {question.required ? null : (
                <span className={styles.optional}> {m.attend_optional()}</span>
              )}
            </label>
            <Input
              id={questionField(question)}
              name={questionField(question)}
              defaultValue={
                typeof given[question.id] === "string"
                  ? String(given[question.id])
                  : undefined
              }
              required={question.required}
              maxLength={writtenAnswerLength}
            />
          </div>
        );
      case "checkbox": {
        // With a label, the question is above the box, as a choice's is.
        const { above, beside } = checkboxWords(question);
        const box = (
          <label key={question.id} className={styles.check}>
            <input
              type="checkbox"
              name={questionField(question)}
              required={question.required}
              defaultChecked={given[question.id] === true}
            />
            {beside}
          </label>
        );
        return above === undefined ? (
          box
        ) : (
          <fieldset key={question.id} className={styles.choice}>
            <legend>{above}</legend>
            {box}
          </fieldset>
        );
      }
      case "choice":
        return (
          <fieldset key={question.id} className={styles.choice}>
            <legend>
              {question.text}
              {question.required ? null : (
                <span className={styles.optional}> {m.attend_optional()}</span>
              )}
            </legend>
            {question.options.map((option) => (
              <label key={option.id} className={styles.check}>
                <input
                  type="radio"
                  name={questionField(question)}
                  value={option.id}
                  required={question.required}
                  defaultChecked={option.id === chosenOption(question, given)}
                />
                {option.text}
              </label>
            ))}
          </fieldset>
        );
      default:
        return null;
    }
  });
}
