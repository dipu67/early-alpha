import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { type TgConfig, type TelegramBot } from "@/lib/types";
import { TelegramTabs } from "./telegram-tabs";

export const dynamic = "force-dynamic";

export default async function TelegramPage() {
  const [cfgRes, botsRes] = await Promise.all([
    backendFetch("/api/tg/config"),
    backendFetch("/api/tg/bots"),
  ]);

  const cfg = (cfgRes.ok ? cfgRes.body : { config: null, alerts: {} }) as {
    config: TgConfig | null;
    alerts: Record<string, boolean>;
  };
  const botsData = (botsRes.ok
    ? botsRes.body
    : { items: [], assignments: {}, topicAssignments: {}, grokBotId: null }) as {
    items: TelegramBot[];
    assignments: Record<string, string | null>;
    topicAssignments?: Record<string, number | null>;
    grokBotId?: string | null;
  };

  const backendOk = cfgRes.ok && botsRes.ok && !!cfg.config;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Telegram"
        description="Manage forum groups & topics, route alerts, and configure the alert chat."
      />

      {!backendOk ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error (config {cfgRes.status}, bots {botsRes.status}). Check the API is running.
        </p>
      ) : null}

      <TelegramTabs
        initialBots={botsData.items}
        initialAssignments={botsData.assignments}
        initialTopicAssignments={botsData.topicAssignments ?? {}}
        initialGrokBotId={botsData.grokBotId ?? null}
        config={
          cfg.config ?? {
            alertChatId: null,
            defaultTopicId: null,
            signalTopicId: null,
            signalTopicMap: {},
            earlyProjectTopicId: null,
            earlyTopicMap: {},
            minIntervalMs: null,
            maxRetries: null,
            adminIds: [],
          }
        }
        alerts={cfg.alerts ?? {}}
      />
    </div>
  );
}
