import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../job-flow.js";

const job = (id, overrides = {}) => ({ title: `Role ${id}`, company: `Company ${id}`, location: "Berlin", url: `https://example.com/jobs/${id}`, ...overrides });

test("append cases A and B retain existing jobs and accept partial batches", () => {
  const existing = [1, 2, 3, 4].map(job);
  assert.equal(JobFlow.appendJobs(existing, Array.from({ length: 12 }, (_, i) => job(i + 5))).jobs.length, 16);
  assert.equal(JobFlow.appendJobs(existing, Array.from({ length: 8 }, (_, i) => job(i + 5))).jobs.length, 12);
});

test("append case C accepts six jobs from a later round", () => {
  const result = JobFlow.appendJobs([1, 2, 3, 4].map(job), Array.from({ length: 6 }, (_, i) => job(i + 5)));
  assert.equal(result.added, 6);
  assert.equal(result.jobs.length, 10);
});

test("append case D retains all existing jobs when every round is empty", () => {
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
  assert.match(source, /s\.jobsJobId=null;s\.jobsPollingPaused=false;s\.jobsRequestId=null;save\(\)/);
  assert.match(source, /s\.jobsFlowId=.*randomUUID/);
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
