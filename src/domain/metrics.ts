import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbDeps } from "./deps";

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

// Reviews are what a PM does to a request in the queue.
const PM_REVIEWS = sql`('review_accepted', 'grouping_overridden')`;

/**
 * Business impact and AI quality, computed in SQL over the event log alone, so they can be
 * recomputed for any period and audited back to the events.
 */
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
            select entity_id as problem_id from events
            where type = 'problem_created' and actor = 'ai'
          )
          select
            count(*) filter (where type = 'request_submitted') as submitted,
            count(*) filter (where type = 'request_deflected') as deflected,
            (select count(*) from ai_problems) as "aiProblems",
            -- A Problem the AI created that a PM merged away was a duplicate it missed.
            (select count(*) from ai_problems a where exists (
              select 1 from events m where m.type = 'problem_merged'
                and (m.payload->>'sourceId')::bigint = a.problem_id)) as "mergedAiProblems",
            (select count(*) from high) as "highGroupings",
            (select count(*) from high h where not exists (
              select 1 from events r where r.entity_type = 'request'
                and r.entity_id = h.request_id and r.actor = 'pm')) as "untouchedHigh",
            -- Every grouping decision the AI made: into an existing Problem, or a new one.
            count(*) filter (where type = 'request_grouped'
              or (type = 'problem_created' and actor = 'ai')) as groupings,
            count(*) filter (where type = 'grouping_overridden') as "groupingOverrides",
            -- Each scoring judges three criteria.
            3 * count(*) filter (where type = 'problem_scored') as scored,
            count(*) filter (where type = 'score_overridden') as "scoreOverrides"
          from events`)
      ).rows[0],
    );

  const median = z.object({
    count: z.coerce.number(),
    medianMinutes: z.coerce.number().nullable(),
  });
  // Triaged: grouped by the AI with high confidence, or reviewed by a PM, whichever came first.
  const timeToTriaged = median.parse(
    (
      await db.execute(sql`
        with triaged as (
          select s.entity_id, min(t.created_at) - s.created_at as took
          from events s
          join events t on t.entity_type = 'request' and t.entity_id = s.entity_id
            and ((t.type = 'request_grouped' and t.payload->>'tier' = 'high')
              or t.type in ${PM_REVIEWS})
          where s.type = 'request_submitted'
          group by s.entity_id, s.created_at
        )
        select count(*) as count,
          percentile_cont(0.5) within group (order by extract(epoch from took) / 60)
            as "medianMinutes"
        from triaged`)
    ).rows[0],
  );
  // From a Problem's creation (its first request) to its supporters' first approved update.
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
        select count(*) as count,
          percentile_cont(0.5) within group (order by extract(epoch from took) / 60)
            as "medianMinutes"
        from first_update`)
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
