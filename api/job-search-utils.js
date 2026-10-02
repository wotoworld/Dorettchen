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

// `directions` is the existing Career Map field rendered as "Richtungen zum
// Erkunden". It is intentionally the only source of search roles.
export function buildSearchStrategy(profile) {
  const directions = compactList(profile?.directions, directionTitle, 10);
  return {
    careerDirections: directions,
    jobTitleFamilyBriefs: directions.map(direction => ({
      direction,
      nearTitles: [`${direction} Intern`, `${direction} Assistant`, `${direction} Coordinator`, `Junior ${direction}`],
      instruction: "use only these obvious entry-level variants"
    })),
    cities: {
      berlin: ["Berlin"],
      europe: EUROPEAN_SEARCH_CITIES
    },
    target: 12,
    berlinTarget: 6,
    searchBudget: directions.length * 2
  };
}

// The complete Career Map is intentionally not sent to web search. This keeps
// the structured matching signals while dropping long, repeated prose.
export function buildSearchProfile(profile, options = {}) {
  return {
    career_directions: compactList(profile?.directions, item => item && ({
      title: text(item.title, 120),
      summary: text(item.summary, 220)
    }), 10),
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
