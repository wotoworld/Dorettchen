export const PUBLIC_JOB_ERROR = Object.freeze({
  status: "error",
  code: "temporarily_unavailable",
  message: "Die Live-Suche ist gerade ausgelastet. Bitte versuche es in einem Moment erneut."
});

const text = (value, limit = 240) => {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, limit) : undefined;
};

const compactList = (values, mapper, limit) => Array.isArray(values)
  ? values.slice(0, limit).map(mapper).filter(Boolean)
  : [];

// The complete Career Map is intentionally not sent to web search. This keeps
// the structured matching signals while dropping long, repeated prose.
export function buildSearchProfile(profile) {
  const dna = profile?.career_dna || {};
  const overview = profile?.profile || {};
  const environment = profile?.environment || {};
  return {
    profile: {
      title: text(overview.title || dna.title, 120),
      summary: text(overview.summary, 420)
    },
    career_dna: compactList(dna.dimensions, item => item && ({
      name: text(item.name, 80),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : undefined,
      signal: text(item.summary || item.short_description, 180)
    }), 12),
    career_axes: compactList(profile?.career_axes, item => item && ({
      name: text(item.name, 80),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : undefined
    }), 12),
    strengths: compactList(profile?.strengths, item => item && ({
      title: text(item.title, 100),
      summary: text(item.summary, 180)
    }), 8),
    career_directions: compactList(profile?.directions, item => item && ({
      title: text(item.title, 120),
      summary: text(item.summary, 220),
      fit: text(item.why_it_fits, 220),
      caution: text(item.watch_out, 160)
    }), 10),
    work_preferences: {
      title: text(environment.environment_title, 120),
      summary: text(environment.environment_summary, 260)
    },
    search_level: "Praktikum oder Junior-Level",
    location_preferences: ["Berlin (Schwerpunkt)", "weitere passende europäische Städte"]
  };
}

export function compactExclusions(exclude) {
  if (!Array.isArray(exclude)) return [];
  const seen = new Set();
  return exclude.slice(0, 150).map(item => {
    if (!item || typeof item !== "object") return null;
    const compact = {
      url: text(item.url, 500),
      company: text(item.company, 120),
      title: text(item.title, 160)
    };
    const key = `${compact.url || ""}|${compact.company || ""}|${compact.title || ""}`.toLowerCase();
    if ((!compact.url && !compact.company && !compact.title) || seen.has(key)) return null;
    seen.add(key);
    return compact;
  }).filter(Boolean);
}

export function isRateLimitError(error) {
  return error?.status === 429 || error?.code === "rate_limit_exceeded" || error?.error?.code === "rate_limit_exceeded";
}

export function retryAfterMs(error) {
  const headers = error?.headers;
  const raw = headers?.get?.("retry-after") ?? headers?.["retry-after"];
  if (raw != null) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const match = String(error?.message || "").match(/retry after\s+([\d.]+)\s*(ms|s|seconds?)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Math.ceil(match[2]?.toLowerCase() === "ms" ? value : value * 1000);
}

export async function withRateLimitRetry(operation, {
  attempts = 5,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onRetry = () => {}
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!isRateLimitError(error) || attempt === attempts - 1) throw error;
      const delay = retryAfterMs(error) ?? 2000 * (2 ** attempt);
      onRetry({ attempt: attempt + 1, delay });
      await sleep(delay);
    }
  }
}
