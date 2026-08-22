import {
  LayoutDashboard,
  Radio,
  Tag,
  KeyRound,
  Settings,
  ListChecks,
  Send,
  Hash,
  Search,
  Sparkles,
  DatabaseBackup,
  Crosshair,
  Radar,
  ClipboardList,
  Link2,
  Github,
  Sprout,
  Activity,
  Eye,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "./rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Minimum role to see this item. */
  minRole?: Role;
}

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/seeds", label: "Seeds", icon: Sprout },
  { href: "/dashboard/growth", label: "Growth", icon: Sparkles },
  { href: "/dashboard/watching", label: "Watching", icon: Eye },
  { href: "/dashboard/hunter", label: "Hunter", icon: Crosshair },
  { href: "/dashboard/monitors", label: "User Monitor", icon: Radar },
  { href: "/dashboard/signals", label: "Signals", icon: Radio },
  { href: "/dashboard/search", label: "Live Search", icon: Search },
  { href: "/dashboard/list-monitors", label: "List Monitors", icon: ClipboardList },
  { href: "/dashboard/chains", label: "New Chains", icon: Link2 },
  { href: "/dashboard/github", label: "GitHub Repos", icon: Github },
  { href: "/dashboard/projects", label: "Projects & Tags", icon: Tag },
  { href: "/dashboard/keywords", label: "Keywords", icon: Hash },
  { href: "/dashboard/auth-accounts", label: "Auth Pool", icon: KeyRound },
  { href: "/dashboard/queues", label: "Queues", icon: ListChecks, minRole: "admin" },
  { href: "/dashboard/telegram", label: "Telegram", icon: Send, minRole: "admin" },
  { href: "/dashboard/grok", label: "Grok", icon: Sparkles, minRole: "editor" },
  { href: "/dashboard/backup", label: "Backup", icon: DatabaseBackup, minRole: "admin" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, minRole: "admin" },
];

/** Human labels for breadcrumbs, keyed by path segment. */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  seeds: "Seeds",
  growth: "Growth",
  watching: "Watching",
  hunter: "Hunter",
  monitors: "User Monitor",
  signals: "Signals",
  search: "Live Search",
  "list-monitors": "List Monitors",
  chains: "New Chains",
  github: "GitHub Repos",
  projects: "Projects & Tags",
  keywords: "Keywords",
  "auth-accounts": "Auth Pool",
  queues: "Queues",
  telegram: "Telegram",
  grok: "Grok",
  backup: "Backup",
  settings: "Settings",
  "remove-old": "Remove Old",
};
