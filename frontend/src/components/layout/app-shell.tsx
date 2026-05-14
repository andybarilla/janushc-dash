import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  ChartLine,
  CheckCircle,
  CircleHelp,
  FileText,
  LogOut,
  Mic,
  Microscope,
  Moon,
  Pill,
  Search,
  Settings,
  Sun,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppShellProps {
  user: { name: string; email: string; role: string };
}

interface NavEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  section: "workspace" | "clinical" | "admin";
  path?: string;
  counter?: number;
}

const SECTION_LABELS: Record<NavEntry["section"], string> = {
  workspace: "Workspace",
  clinical: "Clinical",
  admin: "Administration",
};

const MODULE_LABEL_BY_PATH: Record<string, string> = {
  "/scribe": "Scribe",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function AppShell({ user }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();

  const moduleLabel =
    Object.entries(MODULE_LABEL_BY_PATH).find(([path]) =>
      location.pathname.startsWith(path),
    )?.[1] ?? "Dashboard";

  const items: NavEntry[] = [
    { id: "scribe", label: "Scribe", icon: Mic, section: "workspace", path: "/scribe" },
    { id: "approvals", label: "Approvals", icon: CheckCircle, section: "workspace" },
    { id: "patients", label: "Patients", icon: UserRound, section: "workspace" },
    { id: "schedule", label: "Schedule", icon: CalendarDays, section: "workspace" },
    { id: "records", label: "Records", icon: FileText, section: "workspace" },
    { id: "labs", label: "Labs", icon: Microscope, section: "clinical" },
    { id: "meds", label: "Medications", icon: Pill, section: "clinical" },
    { id: "team", label: "Team", icon: UsersRound, section: "admin" },
    { id: "reports", label: "Reports", icon: ChartLine, section: "admin" },
  ];

  const sections: NavEntry["section"][] = ["workspace", "clinical", "admin"];

  return (
    <div className="janus-scope">
      <div className="janus-app">
        <header className="janus-topbar">
          <div className="janus-brand">
            <div className="janus-brand-mark">J</div>
            <div style={{ display: "flex", alignItems: "baseline", whiteSpace: "nowrap", gap: 4 }}>
              <span className="janus-brand-name">Janus</span>
              <span className="janus-module-sep">/</span>
              <span className="janus-module-name">{moduleLabel}</span>
            </div>
          </div>
          <div className="janus-topbar-search">
            <Search className="janus-search-icon" />
            <input
              type="text"
              placeholder="Search patient ID, encounter ID, or transcript text…"
            />
          </div>
          <div className="janus-topbar-actions">
            <button className="janus-icon-btn" title="Notifications" type="button">
              <Bell />
              <span className="janus-badge-dot" />
            </button>
            <button
              className="janus-icon-btn"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              type="button"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="janus-icon-btn" title="Help" type="button">
              <CircleHelp />
            </button>
            <button className="janus-icon-btn" title="Settings" type="button">
              <Settings />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="janus-avatar"
                  title={user.name}
                  type="button"
                >
                  {getInitials(user.name)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground font-normal">
                    {user.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <aside className="janus-sidebar">
          {sections.map((sec) => (
            <div key={sec}>
              <div className="janus-nav-section-label">{SECTION_LABELS[sec]}</div>
              {items
                .filter((it) => it.section === sec)
                .map((it) => {
                  const Icon = it.icon;
                  const navigable = !!it.path;
                  const active = it.path
                    ? location.pathname.startsWith(it.path)
                    : false;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className={`janus-nav-item ${active ? "active" : ""} ${
                        !navigable ? "disabled" : ""
                      }`}
                      onClick={() => navigable && navigate(it.path!)}
                      disabled={!navigable}
                    >
                      <Icon />
                      <span>{it.label}</span>
                      {it.counter ? (
                        <span className="janus-nav-counter">{it.counter}</span>
                      ) : null}
                    </button>
                  );
                })}
            </div>
          ))}
          <div className="janus-sidebar-bottom">
            <div className="janus-sidebar-status">
              <strong>
                <span className="janus-dot" />
                Pipeline healthy
              </strong>
              AWS HealthScribe · LLM extractor · EHR connector all online.
            </div>
          </div>
        </aside>

        <main className="janus-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
