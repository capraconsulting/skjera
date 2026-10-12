import { Authentication } from "@skjera/oauth/api";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { InvalidTeamName, TeamNotEmpty, TeamNotFound } from "./errors.ts";
import { Team, TeamId, TeamLogosChange } from "./Model.ts";

/** Changing teams, for signed-in users. Teams themselves are synced. */
export class TeamsApi extends HttpApiGroup.make("teams")
  .add(
    /**
     * Creates a team with the id the client picked for it. Creating it
     * again with the same id returns it, so a client can safely retry.
     */
    HttpApiEndpoint.post("create", "/api/teams", {
      payload: Schema.Struct({ id: TeamId, name: Schema.String }),
      success: Team,
      error: InvalidTeamName,
    }),
    HttpApiEndpoint.patch("rename", "/api/teams/:id", {
      params: { id: TeamId },
      payload: Schema.Struct({ name: Schema.String }),
      success: Team,
      error: [InvalidTeamName, TeamNotFound],
    }),
    /** Sets or removes a team's logos: those given; null removes. */
    HttpApiEndpoint.patch("setLogos", "/api/teams/:id/logos", {
      params: { id: TeamId },
      payload: TeamLogosChange,
      success: Team,
      error: TeamNotFound,
    }),
    /** Only teams without documents can be deleted. */
    HttpApiEndpoint.delete("delete", "/api/teams/:id", {
      params: { id: TeamId },
      error: [TeamNotFound, TeamNotEmpty],
    }),
  )
  .middleware(Authentication) {}
