import { useMemo, useState, type FormEvent, type ReactElement } from "react";
import { AlertCircle, Plus, UsersRound, X } from "lucide-react";
import {
  useCreateUser,
  useManagedUsers,
  type CreateUserInput,
  type ManagedUser,
  type UserRole,
} from "@/lib/queries";
import type { ApiError } from "@/lib/api";

interface TeamStat {
  label: string;
  value: number;
}

interface RoleOption {
  value: UserRole;
  label: string;
  helper: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "physician",
    label: "Physician",
    helper: "Can approve and send scribe notes.",
  },
  {
    value: "staff",
    label: "Staff",
    helper: "Can prepare and review operational work, but not physician-only approvals.",
  },
  {
    value: "admin",
    label: "Admin",
    helper: "Can manage team access.",
  },
];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  physician: "Physician",
  staff: "Staff",
};

function formatCreatedDate(value: string): string {
  const createdAt = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(createdAt);
}

function isDuplicateUserError(error: ApiError): boolean {
  return error.status === 409 && error.message.toLowerCase().includes("user already exists");
}

function userErrorMessage(error: ApiError): string {
  if (isDuplicateUserError(error)) {
    return "A user with that email already exists.";
  }
  return error.message || "Unable to add user.";
}

export default function TeamPage(): ReactElement {
  const { data: users = [], isLoading, error } = useManagedUsers();
  const createUser = useCreateUser();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const stats: TeamStat[] = useMemo((): TeamStat[] => {
    const physicianCount = users.filter((user: ManagedUser): boolean => user.role === "physician").length;
    const staffCount = users.filter((user: ManagedUser): boolean => user.role === "staff").length;
    const adminCount = users.filter((user: ManagedUser): boolean => user.role === "admin").length;

    return [
      { label: "Total users", value: users.length },
      { label: "Physicians", value: physicianCount },
      { label: "Staff", value: staffCount },
      { label: "Admins", value: adminCount },
    ];
  }, [users]);

  const selectedRoleHelper = ROLE_OPTIONS.find(
    (option: RoleOption): boolean => option.value === role,
  )?.helper;
  const isSubmitDisabled = createUser.isPending || !name.trim() || !email.trim() || !role;

  const resetForm = (): void => {
    setName("");
    setEmail("");
    setRole("staff");
    setSubmitError(null);
    createUser.reset();
  };

  const openModal = (): void => {
    resetForm();
    setIsModalOpen(true);
  };

  const closeModal = (): void => {
    if (createUser.isPending) return;
    setIsModalOpen(false);
    resetForm();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitDisabled) return;

    setSubmitError(null);
    const input: CreateUserInput = {
      name,
      email,
      role,
    };

    try {
      await createUser.mutateAsync(input);
      setIsModalOpen(false);
      resetForm();
    } catch (caughtError: unknown) {
      const apiError = caughtError as ApiError;
      setSubmitError(userErrorMessage(apiError));
    }
  };

  return (
    <div className="janus-scribe-page">
      <div className="janus-page-header">
        <div>
          <h1>Team</h1>
          <p className="janus-page-subtitle">
            Manage who can access Janus for your practice.
          </p>
        </div>
        <button
          type="button"
          className="janus-btn janus-btn-primary"
          onClick={openModal}
        >
          <Plus />
          Add user
        </button>
      </div>

      <div className="janus-stats-strip janus-team-stats">
        {stats.map((stat: TeamStat): ReactElement => (
          <div className="janus-stat-card" key={stat.label}>
            <div className="janus-stat-label">{stat.label}</div>
            <div className="janus-stat-value">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="janus-team-body">
        <section className="janus-team-card" aria-label="Users">
          {error ? (
            <div className="janus-team-state janus-team-state-error">
              <AlertCircle />
              <div>
                <strong>Unable to load users.</strong>
                <p>Please refresh the page and try again.</p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="janus-team-state">Loading team…</div>
          ) : users.length === 0 ? (
            <div className="janus-team-empty">
              <UsersRound />
              <h2>No users yet.</h2>
              <button
                type="button"
                className="janus-btn janus-btn-primary janus-btn-sm"
                onClick={openModal}
              >
                <Plus />
                Add your first user
              </button>
            </div>
          ) : (
            <div className="janus-team-table-wrap">
              <table className="janus-team-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Created date</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user: ManagedUser): ReactElement => (
                    <tr key={user.id}>
                      <td>{user.name}</td>
                      <td>{user.email}</td>
                      <td>
                        <span className={`janus-team-role janus-team-role-${user.role}`}>
                          {ROLE_LABELS[user.role]}
                        </span>
                      </td>
                      <td>{formatCreatedDate(user.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {isModalOpen ? (
        <div className="janus-modal-backdrop" onClick={closeModal}>
          <form
            className="janus-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-add-user-title"
            onClick={(event): void => event.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <div className="janus-modal-head">
              <UsersRound style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />
              <h3 id="team-add-user-title">Add user</h3>
              <button
                type="button"
                className="janus-icon-btn"
                onClick={closeModal}
                title="Close"
                disabled={createUser.isPending}
              >
                <X />
              </button>
            </div>
            <div className="janus-modal-body">
              <div>
                <label className="janus-label" htmlFor="team-user-name">
                  Name
                </label>
                <input
                  id="team-user-name"
                  className="janus-input"
                  value={name}
                  onChange={(event): void => {
                    setName(event.target.value);
                    setSubmitError(null);
                  }}
                  required
                />
              </div>
              <div>
                <label className="janus-label" htmlFor="team-user-email">
                  Email
                </label>
                <input
                  id="team-user-email"
                  className="janus-input"
                  type="email"
                  value={email}
                  onChange={(event): void => {
                    setEmail(event.target.value);
                    setSubmitError(null);
                  }}
                  required
                />
              </div>
              <div>
                <label className="janus-label" htmlFor="team-user-role">
                  Role
                </label>
                <select
                  id="team-user-role"
                  className="janus-input"
                  value={role}
                  onChange={(event): void => {
                    setRole(event.target.value as UserRole);
                    setSubmitError(null);
                  }}
                  required
                >
                  {ROLE_OPTIONS.map((option: RoleOption): ReactElement => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="janus-team-role-helper">{selectedRoleHelper}</p>
              </div>
              {submitError ? <div className="janus-error-text">{submitError}</div> : null}
            </div>
            <div className="janus-modal-foot">
              <button
                type="button"
                className="janus-btn janus-btn-ghost janus-btn-sm"
                onClick={closeModal}
                disabled={createUser.isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="janus-btn janus-btn-primary janus-btn-sm"
                disabled={isSubmitDisabled}
              >
                {createUser.isPending ? "Adding…" : "Add user"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
