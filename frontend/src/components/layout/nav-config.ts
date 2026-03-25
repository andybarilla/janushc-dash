import { CheckCircle, Mic, FileText, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
}

export const navItems: NavItem[] = [
  { path: "/approvals", label: "Approvals", icon: CheckCircle, roles: ["physician", "admin"] },
  { path: "/scribe", label: "Scribe", icon: Mic, roles: ["physician", "admin"] },
  { path: "/docs", label: "Docs", icon: FileText, roles: ["physician", "staff", "admin"] },
  { path: "/settings", label: "Settings", icon: Settings, roles: ["physician", "staff", "admin"] },
];

export function getNavForRole(role: string): NavItem[] {
  if (role === "admin") return navItems; // admin sees everything
  return navItems.filter((item) => item.roles.includes(role));
}
