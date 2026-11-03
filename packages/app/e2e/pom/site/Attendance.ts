import { expect, type Locator, type Page } from "@playwright/test";

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
    await this.scope.getByRole("button", { name: "Save changes" }).click();
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
      this.scope.getByRole("form", { name: "Your answers" }),
    );
  }

  async clickSignUp(name = "Sign up"): Promise<void> {
    await this.button(name).click();
  }

  async clickAttend(): Promise<void> {
    await this.button("Attend").click();
  }

  /** Signs up as a guest, and checks the signup went through. */
  async signUpAsGuest(name: string, email: string): Promise<void> {
    await this.fillName(name);
    await this.fillEmail(email);
    await this.clickSignUp();
    await this.expectSignedUp();
  }

  /** Attends as the member signed in, and checks it went through. */
  async attend(): Promise<void> {
    await this.clickAttend();
    await this.expectAttending();
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

  async expectNoChangeAnswers(): Promise<void> {
    await expect(this.button("Change answers")).toHaveCount(0);
  }

  async expectSignedUp(text = "You're signed up."): Promise<void> {
    await expect(this.scope).toContainText(text);
  }

  async expectNotSignedUp(): Promise<void> {
    await expect(this.scope).not.toContainText("You're signed up.");
  }

  async expectAttending(): Promise<void> {
    await expect(this.scope).toContainText("You're attending.");
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
      this.scope.getByRole("link", { name: "Log in to attend" }),
    ).toBeVisible();
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
