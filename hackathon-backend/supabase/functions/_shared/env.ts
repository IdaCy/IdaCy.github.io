function parseCommaSeparated(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getEnv() {
  return {
    allowedOrigin: Deno.env.get("HACKATHON_ALLOWED_ORIGIN") || "*",
    allowHeaderIdentity: Deno.env.get("HACKATHON_ALLOW_HEADER_IDENTITY") === "true",
    adminEmails: parseCommaSeparated(Deno.env.get("HACKATHON_ADMIN_EMAILS")),
    allowAdminReset: Deno.env.get("HACKATHON_ALLOW_ADMIN_RESET") === "true",
    eventSlug: Deno.env.get("HACKATHON_EVENT_SLUG") || "spring-2026-baseline-drive",
    graderModel: Deno.env.get("HACKATHON_GRADER_MODEL") || "REPLACE_WITH_FIXED_GRADER_MODEL",
    requireAuth: Deno.env.get("HACKATHON_REQUIRE_AUTH") !== "false",
    requireInvite: Deno.env.get("HACKATHON_REQUIRE_INVITE") !== "false",
    storageBucket: Deno.env.get("HACKATHON_STORAGE_BUCKET") || "hackathon-private-assets",
  };
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
