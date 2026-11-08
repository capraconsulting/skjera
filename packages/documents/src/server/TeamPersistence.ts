import type { SqlClient } from "effect/sql";
import { Team, type TeamId } from "../Model.ts";

export interface TeamFields {
  readonly id: TeamId;
  readonly name: string;
  readonly logo: string | null;
  readonly logo_dark: string | null;
  readonly created_at: Date;
}

export interface TeamWithCount extends TeamFields {
  readonly document_count: number;
}

export const teamColumns = (sql: SqlClient.SqlClient) =>
  sql`id, name, logo, logo_dark, created_at`;

export const toTeam = (row: TeamWithCount) =>
  new Team({
    id: row.id,
    name: row.name,
    logo: row.logo,
    logoDark: row.logo_dark,
    createdAt: row.created_at,
    documentCount: row.document_count,
  });
