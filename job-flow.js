(function (root) {
  const normaliseText = value => String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("de-DE");

  function canonicalUrl(value) {
    try {
      const url = new URL(value);
      url.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(key => url.searchParams.delete(key));
      return url.href.replace(/\/$/, "").toLowerCase();
    } catch {
      return normaliseText(value);
    }
  }

  function identityKeys(job) {
    const url = canonicalUrl(job?.url);
    const tuple = [job?.company, job?.title, job?.location].map(normaliseText).join("|");
    return { url, tuple };
  }

  function dedupeJobs(jobs) {
    const urls = new Set();
    const tuples = new Set();
    return (Array.isArray(jobs) ? jobs : []).filter(job => {
      if (!job?.url || !job?.title || !job?.company) return false;
      const { url, tuple } = identityKeys(job);
      if (urls.has(url) || tuples.has(tuple)) return false;
      urls.add(url);
      tuples.add(tuple);
      return true;
    });
  }

  function appendJobs(existing, incoming) {
    const before = dedupeJobs(existing);
    const combined = dedupeJobs([...before, ...(Array.isArray(incoming) ? incoming : [])]);
    return { jobs: combined, added: combined.length - before.length, duplicatesRemoved: before.length + (incoming?.length || 0) - combined.length };
  }

  root.JobFlow = Object.freeze({ canonicalUrl, identityKeys, dedupeJobs, appendJobs });
})(globalThis);
