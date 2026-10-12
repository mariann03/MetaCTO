import { Suspense } from "react";
import { THRESHOLDS } from "@/domain/intake";
import { getMatchMode } from "@/domain/settings";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";
import { MatchModeForm } from "./match-mode-form";

export default function SettingsPage() {
  return (
    <section className="max-w-2xl space-y-6">
      <h1 className="font-semibold text-2xl">Settings</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <MatchingSettings />
      </Suspense>
    </section>
  );
}

async function MatchingSettings() {
  const { current } = await getSession();
  if (current?.role !== "pm")
    return (
      <p className="text-muted-foreground">
        Only product managers can change settings.
      </p>
    );

  const mode = await getMatchMode(deps);
  return (
    <div className="space-y-4">
      <MatchModeForm mode={mode} />
      <table className="text-sm">
        <caption className="mb-2 text-left text-muted-foreground">
          Thresholds in use (set by the evaluation, read-only)
        </caption>
        <thead>
          <tr className="text-left">
            <th className="pr-6">Mode</th>
            <th className="pr-6">Review from</th>
            <th>Auto-group from</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(THRESHOLDS).map(([name, t]) => (
            <tr key={name}>
              <td className="pr-6">{name}</td>
              <td className="pr-6">{t.low}</td>
              <td>{t.high}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
