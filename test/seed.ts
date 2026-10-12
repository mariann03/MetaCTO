import type { Db } from "@/db/client";
import { listUsers, seedDirectory } from "@/domain/directory";

/** Seeds one account with two submitters and a PM; returns their user ids. */
export async function seedPeople(db: Db) {
  await seedDirectory(
    { db },
    {
      accounts: [
        {
          key: "acc-01",
          name: "Brightside Bakery",
          segment: "smb",
          arr: 4800,
          churnRisk: false,
        },
      ],
      users: [
        { key: "u-01", name: "Alice", role: "submitter", accountKey: "acc-01" },
        { key: "u-02", name: "Bob", role: "submitter", accountKey: "acc-01" },
        { key: "u-03", name: "Priya", role: "pm", accountKey: null },
      ],
      strategy: "",
    },
  );
  const users = await listUsers({ db });
  const id = (name: string) => users.find((u) => u.name === name)?.id ?? 0;
  return { alice: id("Alice"), bob: id("Bob"), priya: id("Priya") };
}
