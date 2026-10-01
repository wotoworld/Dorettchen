import test from 'node:test';
import assert from 'node:assert/strict';
import { compactProfile, jobIdFor, normalizeJobUrl, sanitizeJobs } from '../lib/jobs.js';

const job=(url,extra={})=>({title:'Junior Strategy Intern',company:'Example GmbH',location:'Berlin',type:'Praktikum',url,description:'Konkrete Aufgaben in einem kleinen Team.',why_fit:'Passt zur analytischen Career Map.',source:'careers.example.com',...extra});

test('normalizes tracking URLs into one stable identity',()=>{
  assert.equal(normalizeJobUrl('HTTPS://Careers.Example.com/jobs/42/?utm_source=x#apply'),'https://careers.example.com/jobs/42');
  assert.equal(jobIdFor('https://careers.example.com/jobs/42?utm_source=x'),jobIdFor('https://careers.example.com/jobs/42'));
});

test('sanitizes, de-duplicates and respects exclusions',()=>{
  const url='https://careers.example.com/jobs/42';
  const result=sanitizeJobs([job(url+'?utm_campaign=a'),job(url),job('javascript:alert(1)')]);
  assert.equal(result.length,1);
  assert.equal(result[0].url,url);
  assert.match(result[0].id,/^[a-f0-9]{20}$/);
  assert.deepEqual(sanitizeJobs([job(url)], [url]),[]);
});

test('drops unverifiable incomplete cards',()=>{
  assert.deepEqual(sanitizeJobs([job('https://example.com/job',{why_fit:''})]),[]);
});

test('only forwards known Career Map fields',()=>{
  assert.deepEqual(compactProfile({profile:{title:'Profil'},directions:['Design'],secret:'no'}),{profile:{title:'Profil'},directions:['Design']});
  assert.deepEqual(compactProfile(null),{});
});
