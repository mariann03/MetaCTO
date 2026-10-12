import { Suspense } from "react";
import { listCriteria } from "@/domain/prioritization";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";
import { Ranking } from "./ranking";

export default function PrioritiesPage() {
  return (
    <section className="space-y-6">
      <h1 className="font-semibold text-2xl">Priorities</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Priorities />
      </Suspense>
    </section>
  );
}

async function Priorities() {
  const { current } = await getSession();
  if (current?.role !== "pm")
    return (
      <p className="text-muted-foreground">
        Only product managers can prioritize problems.
      </p>
    );

  const criteria = await listCriteria(deps);
  if (criteria.length === 0)
    return <p className="text-muted-foreground">No problems yet.</p>;
  return <Ranking criteria={criteria} />;
}
