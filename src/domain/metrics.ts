import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbDeps } from "./deps";
import { JUDGED } from "./ranking";

/** A share: `count` out of `of`, null when there is nothing to divide by. */
export interface Rate {
  count: number;
  of: number;
  rate: number | null;
}
/** The median duration over `count` cases, null when there are none. */
export interface Duration {
  count: number;
  medianMinutes: number | null;
}

const rate = (count: number, of: number): Rate => ({
  count,
  of,
  rate: of === 0 ? null : count / of,
});

/** The median of `minutes` over the rows of `cases`, in SQL. */
const medianOf = (cases: string) =>
  sql.raw(`select count(*) as count,
    percentile_cont(0.5) within group (order by extract(epoch from took) / 60)
      as "medianMinutes"
    from ${cases}`);

/**
 * Business impact and AI quality, computed in SQL over the event log alone, so every number
 * can be audited back to the events behind it.
 */
// ponytail: scans the whole log on each view; add a time window (and indexes on payload keys) once it grows.
export async function computeMetrics({ db }: DbDeps) {
  const counts = z
    .object({
      submitted: z.coerce.number(),
      deflected: z.coerce.number(),
      aiProblems: z.coerce.number(),
      mergedAiProblems: z.coerce.number(),
      highGroupings: z.coerce.number(),
      untouchedHigh: z.coerce.number(),
      groupings: z.coerce.number(),
      groupingOverrides: z.coerce.number(),
      scored: z.coerce.number(),
      scoreOverrides: z.coerce.number(),
    })
    .parse(
      (
        await db.execute(sql`
          with high as (
            select entity_id as request_id, created_at from events
            where type = 'request_grouped' and payload->>'tier' = 'high'
          ),
          ai_problems as (
            select entity_id as problem_id, (payload->>'requestId')::bigint as request_id
            from events where type = 'problem_created' and actor = 'ai'
          )
          select
            -- A request resubmitted after a failed analysis is one need, not two.
            count(distinct entity_id) filter (where type = 'request_submitted') as submitted,
            count(*) filter (where type = 'request_deflected') as deflected,
            (select count(*) from ai_problems) as "aiProblems",
            -- A Problem the AI created was a duplicate it missed if a PM merged it away, or
            -- moved the request that founded it into another Problem in review.
            (select count(*) from ai_problems a where exists (
              select 1 from events m where (m.type = 'problem_merged'
                  and (m.payload->>'sourceId')::bigint = a.problem_id)
                or (m.type = 'grouping_overridden' and m.payload->>'action' = 'move'
                  and m.entity_id = a.request_id
                  and (m.payload->>'fromProblemId')::bigint = a.problem_id))) as "mergedAiProblems",
            (select count(*) from high) as "highGroupings",
            (select count(*) from high h where not exists (
              select 1 from events r where r.entity_type = 'request'
                and r.entity_id = h.request_id and r.actor = 'pm')) as "untouchedHigh",
            -- Every grouping decision the AI made: into an existing Problem, or a new one.
            count(*) filter (where type = 'request_grouped'
              or (type = 'problem_created' and actor = 'ai')) as groupings,
            -- Undoing the AI: moving or splitting a request, or merging Problems it kept apart.
            count(*) filter (where type in ('grouping_overridden', 'problem_merged'))
              as "groupingOverrides",
            -- Criteria the AI scored, and those a PM overrode, each counted once.
            ${JUDGED.length} * count(distinct entity_id) filter (where type = 'problem_scored')
              as scored,
            count(distinct (entity_id, payload->>'criterion'))
              filter (where type = 'score_overridden') as "scoreOverrides"
          from events`)
      ).rows[0],
    );

  const median = z.object({
    count: z.coerce.number(),
    medianMinutes: z.coerce.number().nullable(),
  });
  // Triaged: grouped by the AI with high confidence, or reviewed by a PM, whichever came
  // first; the clock starts at the request's first submission.
  const timeToTriaged = median.parse(
    (
      await db.execute(sql`
        with submitted as (
          select entity_id, min(created_at) as at from events
          where type = 'request_submitted' group by entity_id
        ),
        triaged as (
          select s.entity_id, min(t.created_at) - s.at as took
          from submitted s
          join events t on t.entity_type = 'request' and t.entity_id = s.entity_id
            and ((t.type = 'request_grouped' and t.payload->>'tier' = 'high')
              or t.type in ('review_accepted', 'grouping_overridden'))
          group by s.entity_id, s.at
        )
        ${medianOf("triaged")}`)
    ).rows[0],
  );
  // From a Problem's creation (when its first request was analyzed) to its supporters' first
  // approved update.
  const timeToFirstUpdate = median.parse(
    (
      await db.execute(sql`
        with first_update as (
          select c.entity_id, min(u.created_at) - c.created_at as took
          from events c
          join events u on u.type = 'update_approved' and u.entity_id = c.entity_id
            and u.entity_type = 'problem' and u.payload->>'audience' = 'customer'
          where c.type = 'problem_created'
          group by c.entity_id, c.created_at
        )
        ${medianOf("first_update")}`)
    ).rows[0],
  );

  return {
    deflection: rate(counts.deflected, counts.deflected + counts.submitted),
    missedDuplicates: rate(counts.mergedAiProblems, counts.aiProblems),
    handsOff: rate(counts.untouchedHigh, counts.highGroupings),
    timeToTriaged,
    timeToFirstUpdate,
    // Guardrail: how often PMs undo the AI.
    overrides: {
      groupings: rate(counts.groupingOverrides, counts.groupings),
      scores: rate(counts.scoreOverrides, counts.scored),
    },
  };
}
