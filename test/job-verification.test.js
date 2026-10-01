import test from "node:test";
import assert from "node:assert/strict";
import { rankForLocationMix, verifyJob, verifyJobsWithDiagnostics } from "../api/job-verification.js";

const job = { title: "Junior Event Manager", company: "Example Studio", location: "Berlin", type: "Junior", url: "https://jobs.example.com/jobs/event-manager", source: "https://jobs.example.com/very/long/url", fit_score: 90 };
const response = (html, overrides = {}) => ({ ok: true, status: 200, url: job.url, headers: { get: () => "text/html" }, text: async () => html, ...overrides });
const page = extra => `<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Junior Event Manager","hiringOrganization":{"name":"Example Studio"}${extra}}</script></head><body><h1>Junior Event Manager – Example Studio</h1><p>Plan events and coordinate this creative team and its stakeholders across international projects. You own schedules, production details, partner communication and on-site delivery. The role collaborates with designers, producers and clients from concept through review.</p><a>Apply now</a></body></html>`;

test("accepts a reachable, matching and current concrete listing", async () => {
  const verified = await verifyJob(job, { now: new Date("2026-10-01T12:00:00Z"), fetchImpl: async () => response(page(',"datePosted":"2026-09-20"}')) });
  assert.equal(verified.company, job.company);
  assert.equal(verified.published_at, "2026-09-20T00:00:00.000Z");
  assert.match(verified.checked_at, /^2026-10-01/);
  assert.equal(verified.source, "jobs.example.com");
});

test("rejects a listing marked no longer available", async () => {
  const verified = await verifyJob(job, { fetchImpl: async () => response(page("}") + " Job no longer available") });
  assert.equal(verified, null);
});

test("rejects an explicitly dated listing older than 30 days", async () => {
  const verified = await verifyJob(job, { now: new Date("2026-10-01T12:00:00Z"), fetchImpl: async () => response(page(',"datePosted":"2026-08-01"}')) });
  assert.equal(verified, null);
});

test("requires an active application signal when the page has no date", async () => {
  const verified = await verifyJob(job, { fetchImpl: async () => response(page("}").replace("Apply now", "Read more")) });
  assert.equal(verified, null);
});

test("reports age, closed, verification and exact URL duplicate rejections separately", async () => {
  const old = { ...job, url: "https://jobs.example.com/jobs/old" };
  const closed = { ...job, url: "https://jobs.example.com/jobs/closed" };
  const invalid = { ...job, url: "not-a-url" };
  const fetchImpl = async url => {
    if (String(url).endsWith("/old")) return response(page(',"datePosted":"2026-08-01"}'), { url: String(url) });
    if (String(url).endsWith("/closed")) return response(page("}") + " Job no longer available", { url: String(url) });
    return response(page(',"datePosted":"2026-09-20"}'), { url: String(url) });
  };
  const result = await verifyJobsWithDiagnostics([job, { ...job }, old, closed, invalid], { now: new Date("2026-10-01T12:00:00Z"), fetchImpl });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.diagnostics.rejectedByVerification, 1);
  assert.equal(result.diagnostics.rejectedByAge, 1);
  assert.equal(result.diagnostics.rejectedAsClosed, 1);
  assert.equal(result.diagnostics.duplicatesRemoved, 1);
  assert.deepEqual(result.diagnostics.rejectionReasons, { duplicate_url: 1, age: 1, closed: 1, invalid_url: 1 });
  assert.deepEqual(result.diagnostics.candidateOutcomes.map(item => item.reason), [null, "duplicate_url", "age", "closed", "invalid_url"]);
});

test("distinguishes unavailable, generic, identity, and missing-date verification losses", async () => {
  const candidates = [
    { ...job, url: "https://jobs.example.com/jobs" },
    { ...job, url: "https://jobs.example.com/jobs/unavailable" },
    { ...job, url: "https://jobs.example.com/jobs/wrong-title" },
    { ...job, url: "https://jobs.example.com/jobs/no-active-marker" }
  ];
  const fetchImpl = async url => {
    if (String(url).endsWith("unavailable")) throw new Error("network failure");
    if (String(url).endsWith("wrong-title")) return response(page("}").replaceAll("Junior Event Manager", "Unrelated Position"), { url: String(url) });
    return response(page("}").replace("Apply now", "Read more"), { url: String(url) });
  };
  const result = await verifyJobsWithDiagnostics(candidates, { fetchImpl });
  assert.deepEqual(result.diagnostics.rejectionReasons, {
    not_concrete_url: 1,
    page_unavailable: 1,
    title_mismatch: 1,
    date_missing_no_active_marker: 1
  });
});

test("prioritises Berlin while introducing distinct European cities", () => {
  const jobs = ["Berlin", "Berlin", "Berlin", "Berlin", "Berlin", "Berlin", "Berlin", "Paris", "London", "Milan", "Vienna", "Madrid", "Amsterdam"].map((location, index) => ({ location, fit_score: 100 - index }));
  const result = rankForLocationMix(jobs, 12);
  assert.equal(result.filter(item => item.location === "Berlin").length, 7);
  assert.equal(new Set(result.filter(item => item.location !== "Berlin").map(item => item.location)).size, 5);
});
