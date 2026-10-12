import { Suspense } from "react";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <Table>
        <TableCaption>
          Thresholds in use (set by the evaluation, read-only)
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Mode</TableHead>
            <TableHead>Review from</TableHead>
            <TableHead>Auto-group from</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(THRESHOLDS).map(([name, t]) => (
            <TableRow key={name}>
              <TableCell>{name}</TableCell>
              <TableCell>{t.low}</TableCell>
              <TableCell>{t.high}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
