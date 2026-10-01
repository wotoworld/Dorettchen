import { createHash } from "node:crypto";

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "ref", "source"
]);

export function normalizeJobUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

export function jobIdFor(url) {
  return createHash("sha256").update(normalizeJobUrl(url)).digest("hex").slice(0, 20);
}

function text(value, max = 600) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function sanitizeJobs(jobs, excluded = []) {
  const seen = new Set(excluded.map(normalizeJobUrl).filter(Boolean));
  const clean = [];
  for (const candidate of Array.isArray(jobs) ? jobs : []) {
    const url = normalizeJobUrl(candidate?.url);
    const title = text(candidate?.title, 180);
    const company = text(candidate?.company, 140);
    const location = text(candidate?.location, 140);
    const type = text(candidate?.type, 80);
    const description = text(candidate?.description);
    const whyFit = text(candidate?.why_fit);
    const source = text(candidate?.source, 180);
    if (!url || seen.has(url) || !title || !company || !location || !type || !description || !whyFit || !source) continue;
    seen.add(url);
    clean.push({ id: jobIdFor(url), title, company, location, type, url, description, why_fit: whyFit, source });
    if (clean.length === 12) break;
  }
  return clean;
}

export function compactProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return {};
  const allowed = [
    "title", "summary", "description", "profile", "career_dna", "career_axes", "strengths",
    "personal_patterns", "reveals", "self_reveals", "directions", "career_directions", "environment",
    "work_environment", "next_steps", "interests", "industries", "locations",
    "location_preferences", "working_style", "personality"
  ];
  return Object.fromEntries(allowed.filter(key => profile[key] != null).map(key => [key, profile[key]]));
}
