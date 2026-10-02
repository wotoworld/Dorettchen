const CLOSED_MARKERS = [
  "job no longer available", "position filled", "position has been filled",
  "application closed", "applications closed", "no longer accepting applications",
  "job has expired", "vacancy has expired", "stelle nicht mehr verfügbar",
  "stelle nicht mehr verfugbar", "bewerbungsfrist abgelaufen", "nicht mehr ausgeschrieben"
];

const ACTIVE_MARKERS = [
  "apply now", "apply for this job", "apply for this position", "submit application",
  "jetzt bewerben", "bewerben sie sich", "send application", "apply here",
  "start application", "submit your application", "apply to this job", "bewerbung starten"
];

const CLIENT_RENDERED_ATS = ["greenhouse.io", "lever.co", "myworkdayjobs.com", "personio.", "smartrecruiters.com", "join.com", "ashbyhq.com"];

const GENERIC_PATHS = new Set(["", "/", "/jobs", "/careers", "/career", "/jobs/", "/careers/"]);

const cleanText = value => String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const normalise = value => cleanText(value).toLocaleLowerCase("de-DE").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const meaningfulWords = value => normalise(value).split(" ").filter(word => word.length > 2);

function parseDate(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}(?:[T ][^"<\s]+)?/);
  if (!match) return null;
  const date = new Date(match[0]);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function extractPublishedAt(html) {
  // Only dates embedded in the fetched page count as evidence. Search-model data
  // is deliberately not trusted here.
  const candidates = [];
  const patterns = [
    /"datePosted"\s*:\s*"([^"]+)"/gi,
    /"datePublished"\s*:\s*"([^"]+)"/gi,
    /(?:property|name)=["'](?:article:published_time|date|datePosted)["'][^>]*content=["']([^"']+)/gi,
    /content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|date|datePosted)["']/gi,
    /<time[^>]*datetime=["']([^"']+)/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) candidates.push(match[1]);
  }
  for (const value of candidates) {
    const parsed = parseDate(value);
    if (parsed) return parsed.toISOString();
  }
  return null;
}

function matchesIdentity(pageText, value) {
  const words = meaningfulWords(value);
  if (!words.length) return false;
  const haystack = normalise(pageText);
  const required = words.length === 1 ? 1 : Math.min(2, words.length);
  return words.filter(word => haystack.includes(word)).length >= required;
}

function sourceLabel(job, finalUrl) {
  const supplied = cleanText(job.source);
  if (supplied && !/^https?:\/\//i.test(supplied) && supplied.length <= 48) return supplied;
  const host = new URL(finalUrl).hostname.replace(/^www\./, "");
  const known = [["join.com", "JOIN"], ["greenhouse.io", "Greenhouse"], ["lever.co", "Lever"], ["myworkdayjobs.com", "Workday"], ["personio.", "Personio"], ["smartrecruiters.com", "SmartRecruiters"]];
  return known.find(([domain]) => host.includes(domain))?.[1] || host;
}

async function inspectJob(job, { now = new Date(), fetchImpl = fetch } = {}) {
  let url;
  try { url = new URL(job?.url); } catch { return { job: null, reason: "invalid_url" }; }
  const host = url.hostname.toLowerCase();
  if (!/^https?:$/.test(url.protocol) || GENERIC_PATHS.has(url.pathname.toLowerCase()) || host === "localhost" || host.endsWith(".local") || /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return { job: null, reason: "not_concrete_url" };

  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; DorettchenJobVerifier/1.0)", accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(9000)
    });
  } catch { return { job: null, reason: "page_unavailable" }; }
  if (!response.ok || response.status === 204) return { job: null, reason: "page_unavailable", httpStatus: response.status };
  const type = response.headers?.get?.("content-type") || "";
  if (type && !type.includes("html")) return { job: null, reason: "non_html" };
  const html = (await response.text()).slice(0, 1_500_000);
  const pageText = cleanText(html);
  const lower = normalise(pageText);
  const closedMarker = CLOSED_MARKERS.find(marker => lower.includes(normalise(marker)));
  if (closedMarker) return { job: null, reason: "closed", marker: closedMarker };
  if (pageText.length < 250) return { job: null, reason: "page_too_short" };
  if (!matchesIdentity(pageText, job.title)) return { job: null, reason: "title_mismatch" };
  if (!matchesIdentity(pageText, job.company)) return { job: null, reason: "company_mismatch" };

  const publishedAt = extractPublishedAt(html);
  if (publishedAt) {
    const ageDays = (now.valueOf() - new Date(publishedAt).valueOf()) / 86_400_000;
    if (ageDays > 30 || ageDays < -2) return { job: null, reason: "age", publishedAt, ageDays: Math.round(ageDays * 10) / 10 };
  } else if (!ACTIVE_MARKERS.some(marker => lower.includes(normalise(marker))) &&
    !/(?:href|action)=["'][^"']*(?:apply|application|bewerb)/i.test(html) &&
    !CLIENT_RENDERED_ATS.some(domain => host.includes(domain))) {
    // A trustworthy date is optional. Accept varied application controls and
    // known client-rendered ATS pages rather than rejecting a live listing just
    // because its button copy or rendering differs.
    return { job: null, reason: "date_missing_no_active_marker" };
  }

  const finalUrl = response.url || url.href;
  return { job: { ...job, url: finalUrl, source: sourceLabel(job, finalUrl), published_at: publishedAt, checked_at: now.toISOString() }, reason: null };
}

export async function verifyJob(job, options = {}) {
  return (await inspectJob(job, options)).job;
}

export async function verifyJobs(jobs, options = {}) {
  return (await verifyJobsWithDiagnostics(jobs, options)).jobs;
}

export async function verifyJobsWithDiagnostics(jobs, options = {}) {
  const candidates = Array.isArray(jobs) ? jobs.slice(0, 30) : [];
  const settled = await Promise.all(candidates.map(job => inspectJob(job, options)));
  const seen = new Set();
  const diagnostics = { rejectedByVerification: 0, rejectedByAge: 0, rejectedAsClosed: 0, duplicatesRemoved: 0, rejectionReasons: {}, candidateOutcomes: [] };
  const verified = [];
  for (const result of settled) {
    if (!result.job) {
      if (result.reason === "age") diagnostics.rejectedByAge++;
      else if (result.reason === "closed") diagnostics.rejectedAsClosed++;
      else diagnostics.rejectedByVerification++;
      diagnostics.rejectionReasons[result.reason] = (diagnostics.rejectionReasons[result.reason] || 0) + 1;
      diagnostics.candidateOutcomes.push({ url: candidates[diagnostics.candidateOutcomes.length]?.url || null, outcome: "rejected", reason: result.reason, httpStatus: result.httpStatus, marker: result.marker, publishedAt: result.publishedAt, ageDays: result.ageDays });
      continue;
    }
    const key = new URL(result.job.url).href.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) {
      diagnostics.duplicatesRemoved++;
      diagnostics.rejectionReasons.duplicate_url = (diagnostics.rejectionReasons.duplicate_url || 0) + 1;
      diagnostics.candidateOutcomes.push({ url: result.job.url, outcome: "rejected", reason: "duplicate_url" });
    } else {
      seen.add(key); verified.push(result.job);
      diagnostics.candidateOutcomes.push({ url: result.job.url, outcome: "verified", reason: null });
    }
  }
  return { jobs: verified, diagnostics };
}

export function rankForLocationMix(jobs, limit = 15) {
  const ranked = [...jobs].sort((a, b) => (Number(b.fit_score) || 0) - (Number(a.fit_score) || 0));
  const berlin = ranked.filter(job => /\bberlin\b/i.test(job.location || ""));
  const elsewhere = ranked.filter(job => !/\bberlin\b/i.test(job.location || ""));
  const targetBerlin = Math.min(berlin.length, limit >= 12 ? 7 : Math.ceil(limit * 0.6));
  const selected = berlin.slice(0, targetBerlin);
  const citySeen = new Set();
  for (const job of elsewhere) {
    const city = String(job.location || "").split(/[,/·]/)[0].trim().toLowerCase();
    if (city && !citySeen.has(city) && selected.length < limit) { selected.push(job); citySeen.add(city); }
  }
  for (const job of ranked) if (selected.length < limit && !selected.includes(job)) selected.push(job);
  return selected.sort((a, b) => (Number(b.fit_score) || 0) - (Number(a.fit_score) || 0));
}
