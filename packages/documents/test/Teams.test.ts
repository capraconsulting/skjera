import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import { Documents } from "../src/events/Documents.ts";
import type { TeamId } from "../src/Model.ts";
import { Teams } from "../src/Teams.ts";
import { alice, bob, newTeam, syncedDocument, TestLayer } from "./helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Teams", (it) => {
  it.effect("keeps events in their team", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const [red, blue] = [yield* newTeam, yield* newTeam];
      const redEvent = yield* documents.create("event", red, alice);
      const blueEvent = yield* documents.create("event", blue, alice);

      assert.strictEqual((yield* syncedDocument(redEvent))?.teamId, red);
      assert.strictEqual((yield* syncedDocument(blueEvent))?.teamId, blue);
      assert.strictEqual((yield* documents.get(redEvent)).teamId, red);
    }),
  );

  it.effect("creates events only in existing teams", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const error = yield* Effect.flip(
        documents.create(
          "event",
          "01a0f2ff-0000-7000-8000-000000000000" as TeamId,
          alice,
        ),
      );
      assert.strictEqual(error._tag, "TeamNotFound");
    }),
  );

  it.effect("creates a team with the id a client picked, once", () =>
    Effect.gen(function* () {
      const teams = yield* Teams;
      const id = crypto.randomUUID() as TeamId;
      const created = yield* teams.create("Picked", alice, id);
      assert.strictEqual(created.id, id);
      // A retry gets the same team rather than an error.
      const again = yield* teams.create("Picked", alice, id);
      assert.deepStrictEqual(
        [again.id, again.name],
        [created.id, created.name],
      );
    }),
  );

  it.effect("creates and deletes teams", () =>
    Effect.gen(function* () {
      const teams = yield* Teams;
      const documents = yield* Documents;
      const team = yield* teams.create("  Zebra crew  ", alice);
      assert.strictEqual(team.name, "Zebra crew");
      assert.strictEqual((yield* teams.get(team.id)).name, "Zebra crew");

      // Names are unique regardless of case, and can't be blank.
      const taken = yield* Effect.flip(teams.create("zebra CREW", bob));
      assert.strictEqual(taken._tag, "InvalidTeamName");
      const blank = yield* Effect.flip(teams.create("   ", bob));
      assert.strictEqual(blank._tag, "InvalidTeamName");

      // Renaming follows the same rules as creating.
      const other = yield* teams.create("Other crew", alice);
      const renamed = yield* teams.rename(team.id, "  Zebra squad ");
      assert.strictEqual(renamed.name, "Zebra squad");
      const clash = yield* Effect.flip(teams.rename(team.id, "OTHER crew"));
      assert.strictEqual(clash._tag, "InvalidTeamName");
      yield* teams.delete(other.id);

      // A team with events can't be deleted; an empty one can.
      const event = yield* documents.create("event", team.id, alice);
      assert.strictEqual((yield* teams.get(team.id)).documentCount, 1);
      const notEmpty = yield* Effect.flip(teams.delete(team.id));
      assert.strictEqual(notEmpty._tag, "TeamNotEmpty");
      // Deleted, it's kept, but doesn't count: the team goes, and it too.
      yield* documents.delete(event, alice);
      assert.strictEqual((yield* teams.get(team.id)).documentCount, 0);
      yield* teams.delete(team.id);
      const gone = yield* Effect.flip(teams.get(team.id));
      assert.strictEqual(gone._tag, "TeamNotFound");
    }),
  );

  it.effect("sets, replaces and removes a team's logos on their own", () =>
    Effect.gen(function* () {
      const teams = yield* Teams;
      const id = yield* newTeam;
      const light = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";
      const dark = "/api/images/BBBBBBBBBBBBBBBBBBBBBB";
      const darker = "/api/images/CCCCCCCCCCCCCCCCCCCCCC";
      const logos = (team: {
        logo: string | null;
        logoDark: string | null;
      }) => [team.logo, team.logoDark];

      assert.deepStrictEqual(logos(yield* teams.get(id)), [null, null]);

      // The light logo alone.
      assert.deepStrictEqual(
        logos(yield* teams.setLogos(id, { logo: light })),
        [light, null],
      );
      // The dark logo replaced, the light one left as it is.
      yield* teams.setLogos(id, { logoDark: dark });
      assert.deepStrictEqual(
        logos(yield* teams.setLogos(id, { logoDark: darker })),
        [light, darker],
      );
      // Removed one by one.
      assert.deepStrictEqual(logos(yield* teams.setLogos(id, { logo: null })), [
        null,
        darker,
      ]);
      assert.deepStrictEqual(
        logos(yield* teams.setLogos(id, { logoDark: null })),
        [null, null],
      );
      assert.deepStrictEqual(logos(yield* teams.get(id)), [null, null]);

      const missing = yield* Effect.flip(
        teams.setLogos(crypto.randomUUID() as TeamId, { logo: light }),
      );
      assert.strictEqual(missing._tag, "TeamNotFound");
    }),
  );
});
