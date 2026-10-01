import test from "node:test";
import assert from "node:assert/strict";
import { rankForLocationMix, verifyJob } from "../api/job-verification.js";

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

test("prioritises Berlin while introducing distinct European cities", () => {
  const jobs = ["Berlin", "Berlin", "Berlin", "Berlin", "Berlin", "Berlin", "Berlin", "Paris", "London", "Milan", "Vienna", "Madrid", "Amsterdam"].map((location, index) => ({ location, fit_score: 100 - index }));
  const result = rankForLocationMix(jobs, 12);
  assert.equal(result.filter(item => item.location === "Berlin").length, 7);
  assert.equal(new Set(result.filter(item => item.location !== "Berlin").map(item => item.location)).size, 5);
});
