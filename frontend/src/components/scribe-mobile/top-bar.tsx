import type { ReactNode } from "react";
import {
  Bell,
  ChevronLeft,
  LogOut,
  MoreHorizontal,
  Moon,
  Trash2,
  Search,
  Sun,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BaseProps {
  right?: ReactNode;
}

export function MInboxTopBar({
  right,
  hasAlert,
  onBack,
}: BaseProps & { hasAlert?: boolean; onBack?: () => void }) {
  return (
    <div className={`m-topbar${onBack ? " with-back" : ""}`}>
      {onBack ? (
        <button type="button" className="m-back" onClick={onBack} aria-label="Home">
          <ChevronLeft />
          <span>Home</span>
        </button>
      ) : null}
      <div className="m-brand">
        <div className="m-brand-mark">J</div>
        <div className="m-brand-text">
          <span className="brand">Janus</span>
          <span className="module">{onBack ? "Inbox" : "Scribe"}</span>
        </div>
      </div>
      <div className="m-topbar-actions">
        {right ?? (
          <>
            <button type="button" className="m-icon-btn" aria-label="Search">
              <Search />
            </button>
            <button type="button" className="m-icon-btn" aria-label="Notifications">
              <Bell />
              {hasAlert ? <span className="badge-dot" /> : null}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface DetailTopBarProps {
  title: string;
  onBack: () => void;
  onDelete?: () => void;
}

export function MDetailTopBar({ title, onBack, onDelete }: DetailTopBarProps) {
  const { logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <div className="m-detail-topbar">
      <button type="button" className="m-back" onClick={onBack}>
        <ChevronLeft />
        <span>Inbox</span>
      </button>
      <div className="title" title={title}>
        {title}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="m-icon-btn" aria-label="More actions">
            <MoreHorizontal />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 z-[200]">
          {onDelete ? (
            <>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete encounter
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onClick={toggleTheme}>
            {theme === "dark" ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
