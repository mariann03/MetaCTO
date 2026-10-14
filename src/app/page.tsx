import { Suspense } from "react";
import { z } from "zod";
import { ProblemItem } from "@/components/problem-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listProblems,
  PROBLEM_STATUSES,
  searchProblems,
} from "@/domain/problems";
import { STATUS_LABELS } from "@/lib/labels";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";

const ALL = "all";
const STATUS_OPTIONS = [
  { value: ALL, label: "All statuses" },
  ...PROBLEM_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
];
// The URL is user input: anything unexpected (e.g. "all") means no filter.
const filtersSchema = z.object({
  q: z.string().trim().catch(""),
  status: z.enum(PROBLEM_STATUSES).optional().catch(undefined),
});

export default function ExplorePage({ searchParams }: PageProps<"/">) {
  return (
    <section className="space-y-6">
      <h1 className="font-semibold text-2xl">Explore</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Explorer searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function Explorer({
  searchParams,
}: Pick<PageProps<"/">, "searchParams">) {
  const { current } = await getSession();
  // Without users (not seeded yet) the header says so.
  if (!current) return null;
  const { q, status } = filtersSchema.parse(await searchParams);
  const list = q
    ? await searchProblems(deps, { viewerId: current.id, query: q, status })
    : await listProblems(deps, { viewerId: current.id, status });

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-2">
          <Label htmlFor="q">Search problems</Label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Describe a need in your own words"
          />
        </div>
        <div className="space-y-2">
          <Label id="status-label">Status</Label>
          <Select
            name="status"
            items={STATUS_OPTIONS}
            defaultValue={status ?? ALL}
          >
            <SelectTrigger aria-labelledby="status-label" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit">Search</Button>
      </form>
      {list.length === 0 ? (
        <p className="text-muted-foreground">
          {q || status
            ? "No problems match."
            : "No problems yet. Requests will appear here once they are submitted."}
        </p>
      ) : (
        <ul
          aria-label={q ? "Closest problems" : "Problems"}
          className="divide-y rounded-md border"
        >
          {list.map((problem) => (
            <ProblemItem key={problem.id} problem={problem} source="explore" />
          ))}
        </ul>
      )}
    </div>
  );
}
