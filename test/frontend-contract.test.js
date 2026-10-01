import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('saved jobs use storage independent from discovery reset',()=>{
  assert.match(html,/const SAVED_JOBS_KEY='doroSavedJobsV1'/);
  const reset=html.slice(html.indexOf('function resetTestData()'),html.indexOf('const esc='));
  assert.match(reset,/removeItem\('doroCD'\)/);
  assert.doesNotMatch(reset,/removeItem\(SAVED_JOBS_KEY\)/);
});

test('job search has bounded polling and explicit states',()=>{
  assert.match(html,/Date\.now\(\)\+90000/);
  for(const state of ['starting','searching','success','empty','error','timeout']) assert.ok(html.includes(`'${state}'`),`missing ${state}`);
  assert.match(html,/Erneut versuchen/);
});

test('load more and persistence de-duplicate by normalized URL',()=>{
  assert.match(html,/function loadMoreJobs\(\)\{return loadJobs\(true\)\}/);
  assert.match(html,/const excluded=\[\.\.\.existing,\.\.\.savedJobs\]\.map\(jobKey\)/);
  assert.match(html,/if\(!key\|\|seen\.has\(key\)\)return false/);
  assert.match(html,/function toggleSavedJob/);
  assert.match(html,/savedJobs\.splice\(index,1\)/);
  assert.match(html,/savedJobs\.push\(job\)/);
});
