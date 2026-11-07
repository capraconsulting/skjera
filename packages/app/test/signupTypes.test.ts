import type { AttendPayload, SignupChangePayload } from "@skjera/documents/api";
import { expect, expectTypeOf, it } from "vitest";
import { attendPayload } from "../src/sync/signupPayload.ts";
import type { Signup, SignupChange } from "../src/sync/tables.ts";

it("derives the app sign-up metadata from the public API payloads (AC-1)", () => {
  expectTypeOf<Signup>().toEqualTypeOf<Omit<AttendPayload, "id">>();
  expectTypeOf<SignupChange>().toEqualTypeOf<SignupChangePayload>();
});

it("forwards every sign-up metadata field to the API payload (AC-1)", () => {
  const metadata = {
    consent: true,
    referralCode: "ABC",
  } satisfies Signup & { readonly referralCode: string };

  expect(attendPayload("signup-id", metadata)).toEqual({
    id: "signup-id",
    consent: true,
    referralCode: "ABC",
  });
});
