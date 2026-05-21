export interface Department {
  id: string;
  name: string;
}

// Static placeholder list — replace with an Athena-synced source once the EMR integration lands.
export const departments = [
  { id: "dept-1", name: "Department 1" },
  { id: "dept-2", name: "Department 2" },
] as const satisfies readonly Department[];

export const defaultDepartmentId: string = departments[0].id;
