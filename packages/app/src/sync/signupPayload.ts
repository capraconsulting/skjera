import type { AttendPayload, SignupChangePayload } from "@skjera/documents/api";

export type Signup = Omit<AttendPayload, "id">;
export type SignupChange = SignupChangePayload;

export const attendPayload = <Metadata extends Signup>(
  id: AttendPayload["id"],
  metadata: Metadata,
): AttendPayload & Metadata => ({ id, ...metadata });
