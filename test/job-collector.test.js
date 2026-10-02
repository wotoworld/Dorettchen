import test from "node:test";
import assert from "node:assert/strict";
import "../job-flow.js";

const profile = count => ({ directions: Array.from({ length: count }, (_, i) => ({ title: `Direction ${i + 1}` })) });
const job = (id, location = "Berlin") => ({ title: `Role ${id}`, company: `Company ${id}`, location, url: `https://example.com/jobs/${id}` });
const add = (state, ids, location = "Berlin") => JobFlow.recordCollectorSearch(state, ids.map(id => job(id, location)));

test("A: sequential Berlin searches reach six and Europe fills exactly twelve", () => {
  const state = JobFlow.createJobCollector(profile(4));
  add(state, [1, 2, 3]); add(state, [4, 5]); add(state, [6, 7, 8, 9]);
  assert.equal(state.jobs.filter(JobFlow.isBerlinJob).length, 9);
  assert.equal(state.phase, "europe");
  add(state, [10, 11, 12], "Paris");
  assert.equal(state.done, true); assert.equal(JobFlow.collectorResult(state).length, 12);
});

test("B: one call returning six is not a completed batch", () => {
  const state = JobFlow.createJobCollector(profile(3));
  add(state, [1, 2, 3, 4, 5, 6]);
  assert.equal(state.done, false); assert.equal(state.phase, "europe");
  add(state, [7, 8, 9, 10, 11, 12], "Paris");
  assert.equal(state.done, true); assert.equal(state.diagnostics.searchCallsExecuted, 2);
});

test("C: six Berlin plus six Europe returns twelve", () => {
  const state = JobFlow.createJobCollector(profile(2)); add(state, [1, 2, 3, 4, 5, 6]); add(state, [7, 8, 9, 10, 11, 12], "Amsterdam");
  assert.equal(JobFlow.collectorResult(state).length, 12); assert.equal(state.stopReason, "TARGET_REACHED");
});

test("D: nine Berlin plus five Europe is capped at twelve", () => {
  const state = JobFlow.createJobCollector(profile(2)); add(state, [1,2,3,4,5,6,7,8,9]); add(state, [10,11,12,13,14], "Paris");
  assert.equal(JobFlow.collectorResult(state).length, 12);
});

test("E: twenty existing jobs are excluded while twelve new jobs survive", () => {
  const existing = Array.from({length:20}, (_,i)=>job(i+1)); const state=JobFlow.createJobCollector(profile(2), existing);
  add(state, [1,21,22,23,24,25,26]); add(state, [27,28,29,30,31,32], "Vienna");
  assert.equal(JobFlow.collectorResult(state).length,12); assert.ok(JobFlow.collectorResult(state).every(item=>Number(item.url.split('/').pop())>20));
});

test("F: an empty partial search advances to the next Career Map card", () => {
  const state=JobFlow.createJobCollector(profile(3)); add(state, []);
  assert.equal(state.done,false); assert.equal(JobFlow.nextCollectorTask(state).direction,"Direction 2");
});

test("G: fewer results are returned only after the full two-phase budget", () => {
  const state=JobFlow.createJobCollector(profile(2)); add(state,[1]); add(state,[]); add(state,[2],"Paris");
  assert.equal(state.done,false); add(state,[]);
  assert.equal(state.done,true); assert.equal(state.stopReason,"SEARCH_BUDGET_EXHAUSTED"); assert.equal(state.diagnostics.searchCallsExecuted,4); assert.equal(JobFlow.collectorResult(state).length,2);
});
