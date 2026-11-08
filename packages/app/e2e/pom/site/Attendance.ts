import { expect, type Locator, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

/**
 * The fields of signing up: on the form itself, or on the form changing
 * what was given ("Your answers").
 */
export class SignupFields {
  protected readonly scope: Locator;

  constructor(scope: Locator) {
    this.scope = scope;
  }

  private readonly textbox = (name: string | RegExp) =>
    this.scope.getByRole("textbox", { name });

  async fillName(name: string): Promise<void> {
    await this.textbox("Your name").fill(name);
  }

  async fillEmail(email: string): Promise<void> {
    await this.textbox("Your email").fill(email);
  }

  async fillPhone(phone: string): Promise<void> {
    await this.textbox("Your phone number").fill(phone);
  }

  async fillCompany(company: string): Promise<void> {
    await this.textbox("Your company").fill(company);
  }

  async fillDietaryPreferences(text: string): Promise<void> {
    await this.textbox("Dietary preferences").fill(text);
  }

  /** A written answer, to the question its label names. */
  async fillAnswer(question: string | RegExp, text: string): Promise<void> {
    await this.textbox(question).fill(text);
  }

  /** A field by its label, in the page's language. */
  async fillField(label: string, text: string): Promise<void> {
    await this.textbox(label).fill(text);
  }

  async checkOption(name: string): Promise<void> {
    await this.scope.getByRole("radio", { name }).check();
  }

  async checkBox(name: string): Promise<void> {
    await this.scope.getByRole("checkbox", { name }).check();
  }

  async expectField(label: string): Promise<void> {
    await expect(this.textbox(label)).toBeVisible();
  }

  async expectNoField(label: string): Promise<void> {
    await expect(this.textbox(label)).toHaveCount(0);
  }

  /** The field's `name`, as HubSpot reads the form. */
  async expectFieldName(label: string, name: string): Promise<void> {
    await expect(this.textbox(label)).toHaveAttribute("name", name);
  }

  async expectFieldValue(label: string, value: string): Promise<void> {
    await expect(this.textbox(label)).toHaveValue(value);
  }

  /** The message a refused field carries, as its accessible description. */
  async expectFieldMessage(label: string, text: string): Promise<void> {
    await expect(this.textbox(label)).toHaveAccessibleDescription(text);
  }

  async expectFieldOptional(label: string): Promise<void> {
    await expect(this.textbox(label)).not.toHaveAttribute("required");
  }

  /** Members aren't asked for a phone number or a company. */
  async expectNoGuestContact(): Promise<void> {
    await this.expectNoField("Your phone number");
    await this.expectNoField("Your company");
  }

  async expectOption(
    name: string,
    state: "checked" | "unchecked" | "disabled",
  ): Promise<void> {
    const option = this.scope.getByRole("radio", { name });
    if (state === "checked") await expect(option).toBeChecked();
    else if (state === "unchecked") await expect(option).not.toBeChecked();
    else await expect(option).toBeDisabled();
  }

  /** Neither is picked, and the form asks for one. */
  async expectOptionMissing(name: string): Promise<void> {
    expect(
      await this.scope
        .getByRole("radio", { name })
        .evaluate((radio) => (radio as HTMLInputElement).validity.valueMissing),
    ).toBe(true);
  }

  async expectBoxRequired(name: string): Promise<void> {
    await expect(this.scope.getByRole("checkbox", { name })).toHaveAttribute(
      "required",
    );
  }

  async clickSaveChanges(): Promise<void> {
    await this.scope
      .getByRole("button", { name: m.attend_save_changes() })
      .click();
  }

  async clickKeepAsIs(): Promise<void> {
    await this.scope.getByRole("button", { name: m.attend_keep() }).click();
  }
}

/** An event page's Attendance box: signing up, as a member or a guest. */
export class Attendance extends SignupFields {
  private readonly page: Page;

  /** `name` is the box's name in the page's language. */
  constructor(page: Page, name = "Attendance") {
    super(page.getByRole("region", { name }));
    this.page = page;
  }

  private readonly button = (name: string) =>
    this.scope.getByRole("button", { name });

  /** The form changing what was given, once opened. */
  get answers(): SignupFields {
    return new SignupFields(
      this.scope.getByRole("form", { name: m.attend_your_answers() }),
    );
  }

  /** The link under the guest form to the privacy page. */
  async clickPrivacyLink(): Promise<void> {
    await this.scope
      .getByRole("link", { name: m.attend_privacy_link() })
      .click();
  }

  async clickSignUp(name = "Sign up"): Promise<void> {
    await this.button(name).click();
  }

  /** The field that is for bots: it isn't shown, so only a script reaches it. */
  private readonly hiddenField = () =>
    this.scope.locator('input[name="subject"]');

  /** Fills the hidden field by script, as a bot does: it can't be typed into. */
  async fillHiddenField(text: string): Promise<void> {
    await this.hiddenField().evaluate((field, value) => {
      (field as HTMLInputElement).value = value;
    }, text);
  }

  /** The hidden field isn't shown, and Tab from one control to the other never lands in it. */
  async expectHiddenFieldSkipped(
    from: { role: "textbox" | "button"; name: string },
    to: { role: "textbox" | "button"; name: string },
  ): Promise<void> {
    const hidden = this.hiddenField();
    await expect(hidden).toHaveCount(1);
    await expect(hidden).toBeHidden();
    const control = (which: typeof from) =>
      this.scope.getByRole(which.role, { name: which.name });
    await control(from).focus();
    for (let presses = 0; presses < 20; presses++) {
      await this.page.keyboard.press("Tab");
      await expect(hidden).not.toBeFocused();
      const arrived = await control(to).evaluate(
        (element) => element === document.activeElement,
      );
      if (arrived) return;
    }
    throw new Error(`Tab never reached ${to.name}`);
  }

  async clickAttend(): Promise<void> {
    await this.button("Attend").click();
  }

  /** Signs up as a guest, and checks the signup went through, to `email`. */
  async signUpAsGuest(name: string, email: string): Promise<void> {
    await this.fillName(name);
    await this.fillEmail(email);
    await this.clickSignUp();
    await this.expectJustSignedUp(email);
  }

  /**
   * Attends as the member signed in, and checks it went through: to `email`
   * when it is given.
   */
  async attend(email?: string): Promise<void> {
    await this.clickAttend();
    if (email === undefined) await this.expectAttending();
    else await this.expectJustSignedUp(email);
  }

  async cancelSignup(): Promise<void> {
    await this.button("Cancel my signup").click();
  }

  async cancelAttendance(): Promise<void> {
    await this.button("Cancel attendance").click();
  }

  async clickChangeAnswers(): Promise<void> {
    await this.button("Change answers").click();
  }

  /** The form for changing answers is not open. */
  async expectAnswersClosed(): Promise<void> {
    await expect(
      this.scope.getByRole("form", { name: m.attend_your_answers() }),
    ).toHaveCount(0);
  }

  async expectNoChangeAnswers(): Promise<void> {
    await expect(this.button("Change answers")).toHaveCount(0);
  }

  /** Signed up: what the box says on opening the page, or right after signing up. */
  async expectSignedUp(
    text:
      | string
      | RegExp = /You're signed up\.|You've signed up for the event!/,
  ): Promise<void> {
    await expect(this.scope).toContainText(text);
  }

  async expectNotSignedUp(): Promise<void> {
    await expect(this.scope).not.toContainText(
      /You're signed up\.|You've signed up for the event!/,
    );
  }

  /** Attending: what the box says on opening the page, or right after signing up. */
  async expectAttending(): Promise<void> {
    await expect(this.scope).toContainText(
      /You're attending\.|You've signed up for the event!/,
    );
  }

  /** What the box says right after signing up, in that page view: where the confirmation goes. */
  async expectJustSignedUp(email: string): Promise<void> {
    await expect(this.scope).toContainText(
      `You've signed up for the event! You'll get a confirmation at ${email} any moment. We look forward to seeing you!`,
    );
  }

  /** What the box says after cancelling here: whether a confirmation email was sent. */
  async expectCancelled(emailSent = true): Promise<void> {
    await expect(this.scope).toContainText(
      emailSent ? m.cancel_done() : m.cancel_done_no_email(),
    );
  }

  /** The box says nothing of how many are signed up: not the count, not that there are none. */
  async expectNoCount(): Promise<void> {
    await expect(this.scope).toBeVisible();
    await expect(this.scope).not.toContainText(
      /\d+ attending|Nobody has signed up yet\./,
    );
  }

  /** The food deadline the box shows, with `(The deadline has passed)` after it once it has. */
  async expectDietaryDeadline(passed: boolean): Promise<void> {
    const line = this.scope.getByText(/Dietary preferences by /);
    await expect(line).toBeVisible();
    if (passed) await expect(line).toContainText(m.attend_deadline_passed());
    else await expect(line).not.toContainText(m.attend_deadline_passed());
  }

  async expectText(text: string | RegExp): Promise<void> {
    await expect(this.scope).toContainText(text);
  }

  async expectNoText(text: string): Promise<void> {
    await expect(this.scope).not.toContainText(text);
  }

  async expectEmpty(): Promise<void> {
    await this.expectText("Nobody has signed up yet.");
  }

  async expectAlert(text: string): Promise<void> {
    await expect(this.scope.getByRole("alert")).toContainText(text);
  }

  async expectExactAlert(text: string): Promise<void> {
    await expect(this.scope.getByRole("alert")).toHaveText(text);
  }

  async expectSignUpButton(shown: boolean): Promise<void> {
    if (shown) await expect(this.button("Sign up")).toBeVisible();
    else await expect(this.button("Sign up")).toHaveCount(0);
  }

  async expectNoAttendButton(): Promise<void> {
    await expect(this.button("Attend")).toHaveCount(0);
  }

  async expectNoButtons(): Promise<void> {
    await expect(this.scope.getByRole("button")).toHaveCount(0);
  }

  async expectLogInToAttend(): Promise<void> {
    await expect(
      this.scope.getByRole("link", { name: m.attend_log_in_to_attend() }),
    ).toBeVisible();
  }

  /** The button that logs in and comes back to the event. */
  async expectLogInButton(): Promise<void> {
    await expect(
      this.scope.getByRole("button", { name: m.common_log_in() }),
    ).toBeVisible();
  }

  async clickLogIn(): Promise<void> {
    await this.scope.getByRole("button", { name: m.common_log_in() }).click();
  }

  async expectLogInIfSignedUp(): Promise<void> {
    await expect(
      this.scope.getByRole("link", { name: /Signed up\? Log in/ }),
    ).toBeVisible();
  }

  async reload(): Promise<void> {
    await this.page.reload();
  }
}

/**
 * The form under the Attendance box for cancelling by email, without the
 * signup's own link: a region of its own, named in the page's language.
 */
export class CancelByEmail {
  private readonly page: Page;
  private readonly scope: Locator;

  constructor(page: Page, name = "Want to cancel your signup?") {
    this.page = page;
    this.scope = page.getByRole("region", { name });
  }

  private readonly emailField = () =>
    this.scope.getByRole("textbox", {
      name: m.attend_cancel_email_placeholder(),
    });
  private readonly button = () =>
    this.scope.getByRole("button", { name: m.attend_cancel_signup() });
  private readonly hiddenField = () =>
    this.scope.locator('input[name="subject"]');

  async expectShown(): Promise<void> {
    await expect(this.scope).toBeVisible();
    await expect(this.emailField()).toBeVisible();
    await expect(this.button()).toBeVisible();
  }

  async expectAbsent(): Promise<void> {
    await expect(this.scope).toHaveCount(0);
  }

  /** The email field's `name`, which is what a script reading the form sees. */
  async expectEmailFieldName(name: string): Promise<void> {
    await expect(this.emailField()).toHaveAttribute("name", name);
  }

  /** No field of the form has this `name`. */
  async expectNoFieldNamed(name: string): Promise<void> {
    await expect(this.scope.locator(`[name="${name}"]`)).toHaveCount(0);
  }

  async fillEmail(email: string): Promise<void> {
    await this.emailField().fill(email);
  }

  async submit(): Promise<void> {
    await this.button().click();
  }

  /** Fills the hidden field by script, as a bot does: it can't be typed into. */
  async fillHiddenField(text: string): Promise<void> {
    await this.hiddenField().evaluate((field, value) => {
      (field as HTMLInputElement).value = value;
    }, text);
  }

  /** The hidden field isn't shown, and Tab from the email field to the button never lands in it. */
  async expectHiddenFieldSkipped(): Promise<void> {
    const hidden = this.hiddenField();
    await expect(hidden).toHaveCount(1);
    await expect(hidden).toBeHidden();
    await this.emailField().focus();
    for (let presses = 0; presses < 20; presses++) {
      await this.page.keyboard.press("Tab");
      await expect(hidden).not.toBeFocused();
      const arrived = await this.button().evaluate(
        (element) => element === document.activeElement,
      );
      if (arrived) return;
    }
    throw new Error("Tab never reached the button");
  }

  async expectText(text: string | RegExp): Promise<void> {
    await expect(this.scope).toContainText(text);
  }
}
