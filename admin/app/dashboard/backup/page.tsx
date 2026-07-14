import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { BackupPanel } from "./backup-panel";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const res = await backendFetch("/api/backup/summary");
  const summary = (
    res.ok
      ? res.body
      : { tables: [], totalRows: 0 }
  ) as {
    tables: { key: string; table: string; count: number }[];
    totalRows: number;
  };

  return (
    <div>
      <PageHeader
        title="Backup"
        description="Download a full JSON snapshot of every table, or import a previous backup. Admin only. Contains secrets (auth tokens, bot tokens)."
      />

      {!res.ok ? (
        <p className="mb-3 text-sm text-destructive">
          Backend error {res.status}. Restart the API if backup routes were just added.
        </p>
      ) : null}

      <BackupPanel
        initialTables={summary.tables}
        initialTotal={summary.totalRows}
      />
    </div>
  );
}
