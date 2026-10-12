import { Suspense } from "react";
import { SupportButton } from "@/components/support-button";
import { listProblems } from "@/domain/problems";
import { supportersLabel } from "@/lib/utils";
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
  const list = current ? await listProblems(deps, current.id) : [];
  if (!current || list.length === 0)
    return (
      <p className="text-muted-foreground">
        No problems yet. Requests will appear here once they are submitted.
      </p>
    );

  return (
    <ul className="divide-y rounded-md border">
      {list.map((problem) => (
        <li
          key={problem.id}
          aria-label={problem.statement}
          className="space-y-2 p-4"
        >
          <p className="font-medium">{problem.statement}</p>
          <p className="text-muted-foreground text-sm">
            {supportersLabel(problem.supporters)}
          </p>
          <SupportButton
            problemId={problem.id}
            source="explore"
            supported={problem.supported}
          />
        </li>
      ))}
    </ul>
  );
}
