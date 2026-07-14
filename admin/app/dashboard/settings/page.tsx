import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export interface SettingItem {
  key: string;
  masked: string;
  hasValue: boolean;
  updatedAt: string;
}

export default async function SettingsPage() {
  const res = await backendFetch("/api/settings");
  const data = (res.ok ? res.body : { items: [] }) as { items: SettingItem[] };

  return (
    <div>
      <PageHeader
        title="Settings"
        description="App secrets and config keys (masked). Admin only to write — values are stored server-side."
      />

      {!res.ok ? (
        <p className="mb-3 text-sm text-destructive">Backend error {res.status}.</p>
      ) : null}

      <SettingsForm initial={data.items} />
    </div>
  );
}
