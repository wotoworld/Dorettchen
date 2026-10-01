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
    const urls = new Set(before.map(job => identityKeys(job).url));
    const tuples = new Set(before.map(job => identityKeys(job).tuple));
    const combined = [...before];
    let rejectedInvalidShape = 0, rejectedUrlDuplicate = 0, rejectedTupleDuplicate = 0;
    for (const job of Array.isArray(incoming) ? incoming : []) {
      if (!job?.url || !job?.title || !job?.company) { rejectedInvalidShape++; continue; }
      const { url, tuple } = identityKeys(job);
      if (urls.has(url)) { rejectedUrlDuplicate++; continue; }
      if (tuples.has(tuple)) { rejectedTupleDuplicate++; continue; }
      urls.add(url); tuples.add(tuple); combined.push(job);
    }
    return {
      jobs: combined,
      added: combined.length - before.length,
      duplicatesRemoved: rejectedUrlDuplicate + rejectedTupleDuplicate,
      rejectedInvalidShape,
      rejectedUrlDuplicate,
      rejectedTupleDuplicate
    };
  }

  function combineAppendRounds(existing, round1, round2 = []) {
    return appendJobs(existing, [...(Array.isArray(round1) ? round1 : []), ...(Array.isArray(round2) ? round2 : [])]);
  }

  function invalidateStaleSearch(state, currentVersion) {
    if (!state?.jobsJobId || state.jobsSearchVersion === currentVersion) return state;
    return {
      ...state,
      jobsJobId: null,
      jobsSearchVersion: null,
      jobsLoading: false,
      jobsPollingPaused: false,
      jobsAppend: false,
      jobsRequestId: null,
      jobsFlowId: null
    };
  }

  async function pollBackgroundJob({ fetchStatus, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), maxPolls = 90, intervalMs = 3000, initialDelayMs = 500, maxConsecutiveFailures = 4 }) {
    let consecutiveFailures = 0;
    let lastStatus = "queued";
    for (let pollCount = 1; pollCount <= maxPolls; pollCount += 1) {
      await wait(pollCount === 1 ? initialDelayMs : intervalMs);
      try {
        const data = await fetchStatus();
        lastStatus = data?.status || "unknown";
        consecutiveFailures = 0;
        if (lastStatus === "queued" || lastStatus === "in_progress") continue;
        if (lastStatus === "complete" || lastStatus === "completed") return { outcome: "complete", result: data.result || {}, pollCount, lastStatus };
        if (["failed", "cancelled", "incomplete", "error"].includes(lastStatus)) return { outcome: "terminal_error", pollCount, lastStatus };
        throw new Error("unknown_status");
      } catch (error) {
        if (++consecutiveFailures >= maxConsecutiveFailures) return { outcome: "interrupted", pollCount, lastStatus, error };
      }
    }
    return { outcome: "waiting", pollCount: maxPolls, lastStatus };
  }

  root.JobFlow = Object.freeze({ canonicalUrl, identityKeys, dedupeJobs, appendJobs, combineAppendRounds, invalidateStaleSearch, pollBackgroundJob });
})(globalThis);
