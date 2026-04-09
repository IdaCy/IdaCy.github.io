const STORAGE_KEY = "hackathon.auth.session.v1";

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function writeStoredSession(session) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession() {
  window.localStorage.removeItem(STORAGE_KEY);
}

function getDefaultRedirect(config) {
  if (config.placeholders?.authRedirect && !config.placeholders.authRedirect.startsWith("REPLACE_")) {
    return config.placeholders.authRedirect;
  }
  return window.location.origin + window.location.pathname;
}

function parseTokensFromHash() {
  const hash = String(window.location.hash || "").replace(/^#/, "");
  if (!hash.includes("access_token=")) {
    return null;
  }

  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = Number(params.get("expires_in") || 3600);

  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType: params.get("token_type") || "bearer",
  };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(payload?.msg || payload?.error_description || payload?.message || text || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(payload?.msg || payload?.error_description || payload?.message || text || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function isPlaceholder(value) {
  return !value || String(value).startsWith("REPLACE_");
}

export function createAuthController(config) {
  const configured =
    config.backendMode === "api" &&
    config.authMode === "supabase_magic_link" &&
    !isPlaceholder(config.placeholders?.supabaseUrl) &&
    !isPlaceholder(config.placeholders?.supabaseAnonKey);

  let session = readStoredSession();
  let user = null;

  async function refreshSessionIfNeeded() {
    if (!session) {
      return null;
    }

    const isFresh = Number(session.expiresAt || 0) > Date.now() + 30_000;
    if (isFresh) {
      return session;
    }

    if (!session.refreshToken) {
      clearStoredSession();
      session = null;
      user = null;
      return null;
    }

    const refreshed = await postJson(
      `${config.placeholders.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      { refresh_token: session.refreshToken },
      { apikey: config.placeholders.supabaseAnonKey },
    );

    session = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      tokenType: refreshed.token_type || "bearer",
    };
    writeStoredSession(session);
    return session;
  }

  async function loadUserFromSession() {
    if (!configured) {
      return null;
    }

    const freshSession = await refreshSessionIfNeeded();
    if (!freshSession?.accessToken) {
      user = null;
      return null;
    }

    try {
      user = await getJson(`${config.placeholders.supabaseUrl}/auth/v1/user`, {
        apikey: config.placeholders.supabaseAnonKey,
        Authorization: `Bearer ${freshSession.accessToken}`,
      });
      return user;
    } catch (error) {
      clearStoredSession();
      session = null;
      user = null;
      throw error;
    }
  }

  return {
    mode: config.authMode,
    configured,

    async init() {
      if (!configured) {
        return {
          user: null,
          configured: false,
        };
      }

      const hashTokens = parseTokensFromHash();
      if (hashTokens) {
        session = hashTokens;
        writeStoredSession(session);
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }

      try {
        await loadUserFromSession();
      } catch (_error) {
        // Leave user null; the app will present sign-in again.
      }

      return {
        user,
        configured: true,
      };
    },

    getUser() {
      return user;
    },

    isAuthenticated() {
      return Boolean(user && session?.accessToken);
    },

    async sendMagicLink(email) {
      if (!configured) {
        throw new Error("Auth is not configured yet.");
      }

      await postJson(
        `${config.placeholders.supabaseUrl}/auth/v1/otp`,
        {
          email,
          create_user: true,
          options: {
            emailRedirectTo: getDefaultRedirect(config),
          },
        },
        { apikey: config.placeholders.supabaseAnonKey },
      );
    },

    async getRequestHeaders() {
      if (!configured) {
        return {};
      }

      const freshSession = await refreshSessionIfNeeded();
      if (!freshSession?.accessToken) {
        return {};
      }

      return {
        Authorization: `Bearer ${freshSession.accessToken}`,
      };
    },

    async signOut() {
      clearStoredSession();
      session = null;
      user = null;
    },
  };
}
