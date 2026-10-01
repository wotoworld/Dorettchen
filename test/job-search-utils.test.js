import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildSearchProfile,
  buildSearchStrategy,
  compactExclusions,
  PUBLIC_JOB_ERROR,
  withRateLimitRetry
} from "../api/job-search-utils.js";

test("builds a compact matching profile without long Career Map prose", () => {
  const profile = {
    career_dna: { title: "Creative strategist", description: "x".repeat(10_000), dimensions: [{ name: "Kreativität", score: 92, summary: "Konzeptstark" }] },
    profile: { title: "Explorer", summary: "Viele Interessen", description: "y".repeat(10_000) },
    strengths: [{ title: "Organisation", summary: "Verbindet Ideen und Umsetzung", description: "z".repeat(10_000) }],
    directions: [{ title: "Brand Strategy", summary: "Marken und Kultur", description: "q".repeat(10_000), why_it_fits: "Kreativ und analytisch" }],
    environment: { environment_title: "Internationales Team", environment_summary: "Projektorientiert", environment_description: "w".repeat(10_000) }
  };
  const compact = buildSearchProfile(profile);
  const serialized = JSON.stringify(compact);
  assert.ok(serialized.length < 2_000);
  assert.match(serialized, /Brand Strategy/);
  assert.match(serialized, /Kreativität/);
  assert.doesNotMatch(serialized, /xxxxxxxxxx/);
  assert.doesNotMatch(serialized, /description/);
});

test("turns every Career Map direction into a three-level European title-family brief", () => {
  const strategy = buildSearchStrategy({ directions: [
    { title: "Creative Project Management" },
    { title: "Cultural / Arts Management" },
    { title: "Luxury / Brand / Experience" }
  ] }, { append: true });
  assert.deepEqual(strategy.careerDirections, ["Creative Project Management", "Cultural / Arts Management", "Luxury / Brand / Experience"]);
  assert.equal(strategy.jobTitleFamilyBriefs.length, 3);
  assert.ok(strategy.jobTitleFamilyBriefs.every(family => family.nearTitles.some(title => /Intern/.test(title))));
  assert.deepEqual(strategy.levels.map(item => item.level), [1, 2, 3]);
  assert.equal(strategy.cities.tier1[0], "Berlin");
  assert.ok(strategy.cities.tier2.includes("Amsterdam"));
  assert.equal(strategy.target, 6);
});

test("exclude context contains only identity fields and removes duplicates", () => {
  const input = [
    { url: "https://example.com/job", company: "Example", title: "Intern", description: "long", why_fit: "long" },
    { url: "https://example.com/job", company: "Example", title: "Intern", source: "secret" }
  ];
  assert.deepEqual(compactExclusions(input), [{ url: "https://example.com/job", company: "Example", title: "Intern", location: undefined }]);
});

test("rate limit retry: 429 then success", async () => {
  let calls = 0;
  const delays = [];
  const result = await withRateLimitRetry(async () => {
    calls++;
    if (calls === 1) throw { status: 429, headers: { get: () => "1.14" } };
    return "jobs";
  }, { sleep: async ms => delays.push(ms) });
  assert.equal(result, "jobs");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1140]);
});

test("rate limit retry: two 429 responses then success with exponential backoff", async () => {
  let calls = 0;
  const delays = [];
  const result = await withRateLimitRetry(async () => {
    calls++;
    if (calls < 3) throw { code: "rate_limit_exceeded" };
    return "jobs";
  }, { sleep: async ms => delays.push(ms) });
  assert.equal(result, "jobs");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test("rate limit retry stops after five attempts and public error contains no internals", async () => {
  let calls = 0;
  const internal = new Error("org-secret TPM 500000 https://api.openai.com");
  internal.status = 429;
  internal.code = "rate_limit_exceeded";
  await assert.rejects(withRateLimitRetry(async () => { calls++; throw internal; }, { sleep: async () => {} }), internal);
  assert.equal(calls, 5);
  assert.deepEqual(PUBLIC_JOB_ERROR, {
    status: "error",
    code: "temporarily_unavailable",
    message: "Die Live-Suche ist gerade ausgelastet. Bitte versuche es in einem Moment erneut."
  });
  assert.doesNotMatch(JSON.stringify(PUBLIC_JOB_ERROR), /org-secret|TPM|openai/i);
});

test("live search alone uses Terra Medium, required web search and a bounded output", async () => {
  const jobsSource = await readFile(new URL("../api/jobs.js", import.meta.url), "utf8");
  const otherSources = await Promise.all(["analyze.js", "chat.js", "finalize.js"].map(async file => readFile(new URL(`../api/${file}`, import.meta.url), "utf8")));
  assert.match(jobsSource, /model: "gpt-5\.6-terra"/);
  assert.match(jobsSource, /reasoning:\s*\{\s*effort: "medium"/);
  assert.match(jobsSource, /type: "web_search"/);
  assert.match(jobsSource, /tool_choice: "required"/);
  assert.match(jobsSource, /max_output_tokens: 7000/);
  assert.ok(otherSources.every(source => !source.includes("gpt-5.6-terra")));
});

test("initial search remains 12–15 while append has two bounded rounds targeting six new jobs", async () => {
  const jobsSource = await readFile(new URL("../api/jobs.js", import.meta.url), "utf8");
  assert.match(jobsSource, /genau eine fokussierte Recherche/);
  assert.match(jobsSource, /12–15 hochwertige konkrete Stellen/);
  assert.match(jobsSource, /mindestens 7 Treffern/);
  assert.match(jobsSource, /nur 10 oder 11 gute Treffer/);
  assert.match(jobsSource, /APPEND SEARCH – ROUND 1/);
  assert.match(jobsSource, /APPEND SEARCH – ROUND 2/);
  assert.match(jobsSource, /mindestens 6 NEUE/);
  assert.match(jobsSource, /searchRound\) === 2/);
  assert.match(jobsSource, /Career Direction × abgeleiteter Jobtitle-Familie × Standort/);
  assert.match(jobsSource, /search_diagnostics/);
});
