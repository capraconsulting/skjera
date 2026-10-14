import { expect, type Locator, type Page } from "@playwright/test";

export const attendance = (page: Page) =>
  page.getByRole("region", { name: "Attendance" });
export const attendees = (page: Page) =>
  page.getByRole("region", { name: "Attendees" });
export const whoIsComing = (page: Page) =>
  page.getByRole("region", { name: "Who's coming" });
export const members = (page: Page) =>
  whoIsComing(page).getByRole("region", { name: /^Members/ });
export const guests = (page: Page) =>
  whoIsComing(page).getByRole("region", { name: /^Guests/ });
/** Another browser's change comes with a pull: a few pulls' time, when busy. */
export const pulled = { timeout: 20_000 };

/** Members aren't asked for a phone number or a company. */
export const expectNoGuestContact = async (within: Locator) => {
  await expect(
    within.getByRole("textbox", { name: "Your phone number" }),
  ).toHaveCount(0);
  await expect(
    within.getByRole("textbox", { name: "Your company" }),
  ).toHaveCount(0);
};

/** Fills in a guest's name and email on the signup form. */
export const fillGuest = async (box: Locator, name: string, email: string) => {
  await box.getByRole("textbox", { name: "Your name" }).fill(name);
  await box.getByRole("textbox", { name: "Your email" }).fill(email);
};

/** Signs up as a guest, and checks the signup went through. */
export const signUpAsGuest = async (
  box: Locator,
  name: string,
  email: string,
) => {
  await fillGuest(box, name, email);
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");
};
