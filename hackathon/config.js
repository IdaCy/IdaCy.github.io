export const appConfig = {
  backendMode: "mock",
  apiBaseUrl: "https://REPLACE_WITH_BACKEND_BASE_URL",
  authMode: "supabase_magic_link",
  privateTaskAccess: "backend_only",
  release: {
    stage: "public_preview",
    previewMessage:
      "Public preview only. Registration, task access, live stats, and admin controls stay locked until launch.",
  },
  event: {
    id: "spring-2026-baseline-drive",
    name: "Spring 2026 Baseline Drive",
    subtitle: "Initial hackathon for tasks without real human baselines",
    status: "planning_or_mock",
  },
  placeholders: {
    backendBaseUrl: "REPLACE_WITH_BACKEND_BASE_URL",
    supabaseUrl: "REPLACE_WITH_SUPABASE_PROJECT_URL",
    supabaseAnonKey: "REPLACE_WITH_SUPABASE_ANON_KEY",
    graderModel: "REPLACE_WITH_FIXED_GRADER_MODEL",
    adminEmails: "REPLACE_WITH_ADMIN_ALLOWLIST",
    authRedirect: "REPLACE_WITH_MAGIC_LINK_REDIRECT_URL",
    privateSyncRef: "REPLACE_WITH_PRIVATE_TASK_IMPORT_REF",
  },
};

export const appCapabilities = {
  mockSupportsPrivateTasks: false,
  mockSupportsAsyncGrading: true,
  mockSupportsLiveStats: true,
  authSupportsInviteOnlyAccess: true,
  backendRequiredFor: [
    "private benchmark payload delivery",
    "multi-user live stats",
    "shared submissions",
    "magic-link auth",
    "signed asset URLs",
  ],
};
