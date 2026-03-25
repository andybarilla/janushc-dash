import { CheckCircle, Mic, FileText, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
}

export const navItems: NavItem[] = [
  { path: "/approvals", label: "Approvals", icon: CheckCircle, roles: ["physician"] },
  { path: "/scribe", label: "Scribe", icon: Mic, roles: ["physician"] },
  { path: "/docs", label: "Docs", icon: FileText, roles: ["physician", "staff"] },
  { path: "/settings", label: "Settings", icon: Settings, roles: ["physician", "staff"] },
];

export function getNavForRole(role: string): NavItem[] {
  return navItems.filter((item) => item.roles.includes(role));
}
