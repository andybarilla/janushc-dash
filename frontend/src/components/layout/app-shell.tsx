import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { getNavForRole, type NavItem } from "./nav-config";

interface AppShellProps {
  user: { name: string; email: string; role: string };
}

function NavIcon({ item, className }: { item: NavItem; className?: string }) {
  return (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center justify-center gap-1 transition-colors",
          isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
          className,
        )
      }
    >
      <item.icon className="h-5 w-5" />
      <span className="text-[10px] md:hidden">{item.label}</span>
    </NavLink>
  );
}

export function AppShell({ user }: AppShellProps) {
  const nav = getNavForRole(user.role);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Desktop: side rail */}
      <aside className="hidden md:flex flex-col items-center w-14 border-r bg-muted/30 py-4 gap-4">
        <div className="font-bold text-primary text-lg mb-2">J</div>
        {nav.map((item) => (
          <NavIcon key={item.path} item={item} className="w-10 h-10 rounded-lg" />
        ))}
      </aside>

      <div className="flex-1 flex flex-col min-h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b bg-background">
          <div className="font-semibold text-sm md:text-base">Janus HC</div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu name={user.name} email={user.email} />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4">
          <Outlet />
        </main>
      </div>

      {/* Mobile: bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 border-t bg-background flex justify-around py-2 z-50">
        {nav.map((item) => (
          <NavIcon key={item.path} item={item} />
        ))}
      </nav>
    </div>
  );
}
