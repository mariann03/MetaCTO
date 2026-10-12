import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { Db } from "@/db/client";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import type { Deps } from "./deps";
import {
  type DirectoryFixtures,
  getStrategy,
  listUsers,
  parseDirectoryFixtures,
  seedDirectory,
} from "./directory";

const fixtures = {
  accounts: [
    {
      key: "acc-01",
      name: "Brightside Bakery",
      segment: "smb",
      arr: 4800,
      churnRisk: true,
    },
    {
      key: "acc-02",
      name: "Northwind Logistics",
      segment: "enterprise",
      arr: 420000,
      churnRisk: false,
    },
  ],
  users: [
    {
      key: "u-01",
      name: "Ana Torres",
      role: "submitter",
      accountKey: "acc-01",
    },
    {
      key: "u-02",
      name: "Ben Okafor",
      role: "submitter",
      accountKey: "acc-02",
    },
    {
      key: "u-03",
      name: "Dana Ruiz (Support)",
      role: "submitter",
      accountKey: null,
    },
    { key: "u-04", name: "Priya Shah", role: "pm", accountKey: null },
  ],
  strategy: "# Strategy\n\nMove upmarket.",
} satisfies DirectoryFixtures;

let db: Db;
let deps: Pick<Deps, "db">;

beforeAll(async () => {
  db = await prepareDatabase(TEST_DATABASE_URL);
  deps = { db };
});
beforeEach(() => resetDatabase(db));
afterAll(() => db?.$client.end());

describe("directory", () => {
  test("seeded users are listed with their account, submitters before PMs", async () => {
    await seedDirectory(deps, fixtures);

    const users = await listUsers(deps);

    expect(users.map((u) => [u.name, u.role, u.account?.name ?? null])).toEqual(
      [
        ["Ana Torres", "submitter", "Brightside Bakery"],
        ["Ben Okafor", "submitter", "Northwind Logistics"],
        ["Dana Ruiz (Support)", "submitter", null],
        ["Priya Shah", "pm", null],
      ],
    );
  });

  test("seeding twice updates in place instead of duplicating", async () => {
    await seedDirectory(deps, fixtures);
    await seedDirectory(deps, {
      ...fixtures,
      users: fixtures.users.map((u) =>
        u.key === "u-01" ? { ...u, name: "Ana Torres-Vega" } : u,
      ),
    });

    const users = await listUsers(deps);

    expect(users).toHaveLength(4);
    expect(users[0]?.name).toBe("Ana Torres-Vega");
  });

  test("the strategy document is stored and readable", async () => {
    await seedDirectory(deps, fixtures);

    expect(await getStrategy(deps)).toBe("# Strategy\n\nMove upmarket.");
  });

  test("fixture files are validated before seeding", () => {
    expect(parseDirectoryFixtures(fixtures)).toEqual(fixtures);
    expect(() =>
      parseDirectoryFixtures({
        ...fixtures,
        accounts: [{ ...fixtures.accounts[0], segment: "startup" }],
      }),
    ).toThrow();
    expect(() =>
      parseDirectoryFixtures({
        ...fixtures,
        users: [{ key: "u-09", role: "pm", accountKey: null }],
      }),
    ).toThrow();
    // A misspelled key must fail instead of silently falling back to the default.
    const { churnRisk, ...account } = fixtures.accounts[0];
    expect(() =>
      parseDirectoryFixtures({
        ...fixtures,
        accounts: [{ ...account, churnrisk: churnRisk }],
      }),
    ).toThrow();
    expect(() =>
      parseDirectoryFixtures({
        ...fixtures,
        users: [{ key: "u-09", name: "P", role: "pm", accountKey: "acc-01" }],
      }),
    ).toThrow();
  });

  test("strategy is empty before anything is seeded", async () => {
    expect(await getStrategy(deps)).toBe("");
  });
});
