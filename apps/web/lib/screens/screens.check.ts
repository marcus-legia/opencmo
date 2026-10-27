/**
 * The v2 screen contracts hold (UI plan, Task U0):
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/screens/screens.check.ts
 *
 * Every fixture and every empty value parses with its screen's schema; `live` and `release` name real fields;
 * a field with a live flag has a loader; and `compose` never hands sample data to production.
 */
import assert from "node:assert/strict";

import { ApprovalCardSchema, CARD_KINDS } from "./approval-card";
import { ALL_KINDS, STATE_CARDS } from "./fixtures/cards";
import { LOADERS } from "./load";
import { SCREEN_NAMES, SCREENS, compose, released, type ScreenName } from "./registry";

const failures: string[] = [];

function check(name: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

for (const name of SCREEN_NAMES) {
  const screen = SCREENS[name];
  const fields = Object.keys(screen.schema.shape);
  check(`${name}: fixture parses`, () => void screen.schema.parse(screen.fixture));
  check(`${name}: empty parses`, () => void screen.schema.parse(screen.empty));
  check(`${name}: live and release name fields`, () => {
    for (const field of [...screen.live, ...screen.release]) assert.ok(fields.includes(field), `unknown field ${field}`);
  });
  check(`${name}: a live field has a loader`, () => {
    if (screen.live.length > 0) assert.ok(LOADERS[name], "live fields but no loader");
  });

  check(`${name}: production never shows sample data`, () => {
    const loaded = screen.fixture as Record<string, unknown>;
    const out = compose(name as ScreenName, loaded as never, { production: true, sample: true });
    for (const field of fields) {
      const expected = (screen.live as readonly string[]).includes(field) ? loaded[field] : (screen.empty as Record<string, unknown>)[field];
      assert.deepEqual((out.data as Record<string, unknown>)[field], expected, field);
    }
  });

  check(`${name}: sample=1 gives the pure fixture, all fields not live`, () => {
    const out = compose(name as ScreenName, {}, { production: false, sample: true });
    assert.deepEqual(out.data, screen.schema.parse(screen.fixture));
    assert.ok(Object.values(out.live).every((v) => v === false));
  });

  check(`${name}: a loader cannot make an unlisted field live`, () => {
    const out = compose(name as ScreenName, screen.empty as never, { production: false, sample: false });
    for (const field of fields) {
      assert.equal(out.live[field as keyof typeof out.live], (screen.live as readonly string[]).includes(field), field);
      if (!(screen.live as readonly string[]).includes(field)) {
        assert.deepEqual((out.data as Record<string, unknown>)[field], (screen.fixture as Record<string, unknown>)[field], field);
      }
    }
  });

  check(`${name}: release follows live`, () => {
    assert.equal(released(name), screen.release.every((f) => (screen.live as readonly string[]).includes(f)));
  });
}

check("cards: one sample of each of the ten kinds", () => {
  assert.deepEqual(ALL_KINDS.map((c) => c.kind), [...CARD_KINDS]);
  for (const card of [...ALL_KINDS, ...STATE_CARDS]) ApprovalCardSchema.parse(card);
});

check("cards: a body of another kind is refused", () => {
  const [post, reply] = ALL_KINDS;
  assert.equal(ApprovalCardSchema.safeParse({ ...post, body: reply.body }).success, false);
});

check("dashboard: queue holds only waiting cards, team has six nodes", () => {
  const { queue, team } = SCREENS.dashboard.fixture;
  assert.ok(queue.every((c) => c.status === "waiting"));
  assert.equal(team.nodes.length, 6);
});

if (failures.length) {
  console.error(`screens.check: ${failures.length} failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`screens.check: ${SCREEN_NAMES.length} screens, ${ALL_KINDS.length + STATE_CARDS.length} cards ok`);
