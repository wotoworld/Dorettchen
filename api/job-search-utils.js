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

export const EUROPEAN_SEARCH_CITIES = Object.freeze([
  "Berlin", "Amsterdam", "Copenhagen", "Paris", "London", "Milan",
  "Barcelona", "Madrid", "Vienna", "Lisbon", "Stockholm", "Antwerp",
  "Brussels", "Munich", "Hamburg", "Zurich", "Dublin", "Prague"
]);

const directionTitle = item => typeof item === "string" ? text(item, 120) : text(item?.title, 120);

// This is deliberately a search brief, not a hard-coded title catalogue. Terra
// derives context-specific title families from every Career Map direction while
// searching. Keeping the three levels explicit prevents repeated generic rounds.
export function buildSearchStrategy(profile, { append = false } = {}) {
  const directions = compactList(profile?.directions, directionTitle, 10);
  return {
    careerDirections: directions,
    jobTitleFamilyBriefs: directions.map(direction => ({
      direction,
      nearTitles: [`${direction} Intern`, `${direction} Assistant`, `${direction} Coordinator`, `Junior ${direction}`],
      instruction: "derive additional context-specific synonyms and adjacent entry titles from this direction and the Career Map"
    })),
    entryRoleTypes: ["Internship", "Intern", "Praktikum", "Praktikant/in", "Trainee", "Assistant", "Coordinator", "Junior", "Working Student", "Werkstudent", "Entry Level"],
    cities: {
      tier1: ["Berlin"],
      tier2: EUROPEAN_SEARCH_CITIES.slice(1)
    },
    levels: [
      { level: 1, scope: "Berlin first", titles: "exact or very close entry-level versions of every Career Map direction" },
      { level: 2, scope: "Berlin, then Europe", titles: "context-specific synonyms and related entry-level title families derived from every direction" },
      { level: 3, scope: "Europe wide", titles: "adjacent entry roles sharing the profile's core skills and industry interests" }
    ],
    target: append ? 6 : 15,
    berlinTarget: append ? undefined : 7
  };
}

// The complete Career Map is intentionally not sent to web search. This keeps
// the structured matching signals while dropping long, repeated prose.
export function buildSearchProfile(profile, options = {}) {
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
    location_preferences: ["Berlin (Schwerpunkt)", "weitere passende europäische Städte"],
    search_strategy: buildSearchStrategy(profile, options)
  };
}

export function compactExclusions(exclude) {
  if (!Array.isArray(exclude)) return [];
  const seen = new Set();
  // Keep follow-up searches compact while still excluding displayed and saved jobs.
  return exclude.slice(0, 250).map(item => {
    if (!item || typeof item !== "object") return null;
    const compact = {
      url: text(item.url, 500),
      company: text(item.company, 120),
      title: text(item.title, 160),
      location: text(item.location, 120)
    };
    const key = `${compact.url || ""}|${compact.company || ""}|${compact.title || ""}|${compact.location || ""}`.toLowerCase();
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
