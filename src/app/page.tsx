import { Suspense } from "react";
import { ProblemItem } from "@/components/problem-item";
import { listProblems } from "@/domain/problems";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";

export default function ExplorePage() {
  return (
    <section className="space-y-6">
      <h1 className="font-semibold text-2xl">Explore</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <ProblemList />
      </Suspense>
    </section>
  );
}

async function ProblemList() {
  const { current } = await getSession();
  // Without users (not seeded yet) the header says so.
  if (!current) return null;
  const list = await listProblems(deps, current.id);
  if (list.length === 0)
    return (
      <p className="text-muted-foreground">
        No problems yet. Requests will appear here once they are submitted.
      </p>
    );

  return (
    <ul className="divide-y rounded-md border">
      {list.map((problem) => (
        <ProblemItem key={problem.id} problem={problem} source="explore" />
      ))}
    </ul>
  );
}
