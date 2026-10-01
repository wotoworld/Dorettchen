import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../job-flow.js";

const job = (id, overrides = {}) => ({ title: `Role ${id}`, company: `Company ${id}`, location: "Berlin", url: `https://example.com/jobs/${id}`, ...overrides });

test("case A: seven unique round-one jobs append without needing round two", () => {
  const existing = Array.from({ length: 20 }, (_, i) => job(i + 1));
  const result = JobFlow.combineAppendRounds(existing, Array.from({ length: 7 }, (_, i) => job(i + 21)));
  assert.equal(result.added, 7);
  assert.equal(result.jobs.length, 27);
});

test("case B: four plus five with two duplicates append seven unique jobs", () => {
  const existing = Array.from({ length: 20 }, (_, i) => job(i + 1));
  const round1 = [21, 22, 23, 24].map(job);
  const round2 = [23, 24, 25, 26, 27].map(job);
  const result = JobFlow.combineAppendRounds(existing, round1, round2);
  assert.equal(result.added, 7);
});

test("append case C accepts six jobs from a later round", () => {
  const result = JobFlow.appendJobs([1, 2, 3, 4].map(job), Array.from({ length: 6 }, (_, i) => job(i + 5)));
  assert.equal(result.added, 6);
  assert.equal(result.jobs.length, 10);
});

test("append fallback combines one level-one result with seven expanded Career Direction results", () => {
  const existing = Array.from({ length: 20 }, (_, i) => job(i + 1));
  const level1 = [job(21)];
  const expanded = Array.from({ length: 7 }, (_, i) => job(i + 22));
  const result = JobFlow.combineAppendRounds(existing, level1, expanded);
  assert.equal(result.added, 8);
  assert.equal(result.jobs.length, 28);
  assert.equal(result.duplicatesRemoved, 0);
});

test("case D: partial results from both rounds are never discarded below target", () => {
  const existing = Array.from({ length: 20 }, (_, i) => job(i + 1));
  const result = JobFlow.combineAppendRounds(existing, [job(21), job(22)], [job(23)]);
  assert.equal(result.added, 3);
  assert.equal(result.jobs.length, 23);
});

test("case E: both empty rounds retain all existing jobs", () => {
  const existing = [1, 2, 3, 4].map(job);
  const result = JobFlow.appendJobs(existing, []);
  assert.equal(result.added, 0);
  assert.deepEqual(result.jobs, existing);
});

test("deduplication uses URL or company-title-location, never company alone", () => {
  const existing = [job(1, { company: "Same Company", title: "Project Intern" })];
  const incoming = [
    job(2, { company: "Same Company", title: "Marketing Intern" }),
    job(3, { url: "https://example.com/jobs/1?utm_source=test" }),
    job(4, { company: "Same Company", title: "Project Intern", location: "Berlin" })
  ];
  const result = JobFlow.appendJobs(existing, incoming);
  assert.equal(result.added, 1);
  assert.equal(result.jobs[1].title, "Marketing Intern");
});

test("append diagnostics distinguish URL and identity-tuple duplicates", () => {
  const existing = [{ title: "Role A", company: "Acme", location: "Berlin", url: "https://acme.test/a" }];
  const result = JobFlow.appendJobs(existing, [
    { title: "Different", company: "Elsewhere", location: "Paris", url: "https://acme.test/a/" },
    { title: "Role A", company: "Acme", location: "Berlin", url: "https://acme.test/b" },
    { title: "Role B", company: "Acme", location: "Berlin", url: "https://acme.test/c" }
  ]);
  assert.equal(result.added, 1);
  assert.equal(result.rejectedUrlDuplicate, 1);
  assert.equal(result.rejectedTupleDuplicate, 1);
  assert.equal(result.rejectedInvalidShape, 0);
});

test("stale persisted search ids are discarded without deleting displayed jobs", () => {
  const jobs = [job(1)];
  const stale = JobFlow.invalidateStaleSearch({ jobs, jobsJobId: "old-job", jobsSearchVersion: 1, jobsLoading: true, jobsAppend: true }, 2);
  assert.equal(stale.jobsJobId, null);
  assert.equal(stale.jobsSearchVersion, null);
  assert.equal(stale.jobsLoading, false);
  assert.equal(stale.jobsAppend, false);
  assert.strictEqual(stale.jobs, jobs);

  const current = { jobs, jobsJobId: "current-job", jobsSearchVersion: 2, jobsLoading: true };
  assert.strictEqual(JobFlow.invalidateStaleSearch(current, 2), current);
});

test("unversioned legacy search ids are stale and the current version is persisted with new ids", async () => {
  const legacy = JobFlow.invalidateStaleSearch({ jobsJobId: "legacy-job", jobsLoading: true }, 2);
  assert.equal(legacy.jobsJobId, null);

  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /JOBS_SEARCH_VERSION=3/);
  assert.match(source, /s\.jobsJobId=data\.jobId;s\.jobsSearchVersion=JOBS_SEARCH_VERSION;save\(\)/);
  assert.doesNotMatch(source, /cancel.*jobsJobId|jobsJobId.*cancel/i);
});

test("append UI exposes no-results and friendly error retry states", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /Diesmal konnten keine weiteren verifizierten Stellen gefunden werden\./);
  assert.match(source, /Weitere Stellen konnten gerade nicht geladen werden\./);
  assert.match(source, /Noch einmal suchen →/);
  assert.doesNotMatch(source, /jobsError=e\.message/);
});

test("reload resumes a persisted job while a completed run is cleared before a new click", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /if\(s\.jobsJobId&&!s\.jobsPollingPaused&&!jobsPollingActive\)setTimeout\(\(\)=>resumeJobsPolling\(\),80\)/);
  assert.match(source, /s\.jobs=merged\.jobs;s\.jobsLoaded=true;s\.jobsLoading=false;s\.jobsJobId=null;s\.jobsSearchVersion=null;s\.jobsPollingPaused=false/);
  assert.match(source, /s\.jobsFlowId=.*randomUUID/);
});

test("append completion starts at most one expanded second round", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /if\(round===1&&pending\.length<6\)/);
  assert.match(source, /s\.jobsRound=2/);
  assert.doesNotMatch(source, /jobsRound=3|MAX_JOB_SEARCH_ROUNDS/);
  assert.match(source, /\.\.\.savedJobs,\.\.\.pending/);
});

test("a background job still running beyond the polling window is preserved for a later retry", async () => {
  let requests = 0;
  const result = await JobFlow.pollBackgroundJob({
    fetchStatus: async () => ({ status: ++requests <= 95 ? "in_progress" : "complete", result: { jobs: [job(1)] } }),
    wait: async () => {},
    maxPolls: 90
  });
  assert.deepEqual({ outcome: result.outcome, pollCount: result.pollCount, lastStatus: result.lastStatus }, { outcome: "waiting", pollCount: 90, lastStatus: "in_progress" });
  assert.equal(requests, 90);
});

test("long-running job UI pauses without a spinner, keeps the id, and offers status retry", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /Die Suche dauert länger als erwartet\./);
  assert.match(source, /onclick="retryJobsPolling\(\)"/);
  assert.match(source, /s\.jobsLoading=false;s\.jobsPollingPaused=true/);
  assert.doesNotMatch(source, /if\(s\.jobsJobId\)finishJobsError/);
});
