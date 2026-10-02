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

  const JOB_TARGET_TOTAL = 12;
  const JOB_TARGET_BERLIN = 6;

  function isBerlinJob(job) {
    return /\bberlin\b/i.test(String(job?.location || ""));
  }

  function directionTitles(profile) {
    return (Array.isArray(profile?.directions) ? profile.directions : [])
      .map(item => typeof item === "string" ? item : item?.title)
      .map(value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 10);
  }

  function createJobCollector(profile, excluded = []) {
    const directions = directionTitles(profile);
    return {
      targetTotal: JOB_TARGET_TOTAL,
      targetBerlin: JOB_TARGET_BERLIN,
      maxSearchCalls: directions.length * 2 + Math.min(2, directions.length),
      directions,
      phase: "berlin",
      directionIndex: 0,
      jobs: [],
      excluded: dedupeJobs(excluded),
      diagnostics: {
        careerMapJobCardsAvailable: directions.length,
        careerMapJobCardsUsed: [], searchCallsExecuted: 0,
        berlinSearchCalls: 0, europeSearchCalls: 0,
        rawCandidatesFound: 0, verifiedCandidates: 0, duplicatesRemoved: 0
      },
      stopRequested: false,
      berlinTopUp: false,
      done: directions.length === 0,
      stopReason: directions.length === 0 ? "SEARCH_BUDGET_EXHAUSTED" : null
    };
  }

  function nextCollectorTask(state) {
    if (!state || state.done || state.stopRequested || !state.directions?.length) return null;
    return {
      phase: state.phase,
      direction: state.directions[state.directionIndex],
      directionIndex: state.directionIndex,
      locations: state.phase === "berlin" ? ["Berlin"] : [
        "Berlin", "Amsterdam", "Copenhagen", "Paris", "London", "Milan",
        "Barcelona", "Madrid", "Vienna", "Lisbon", "Stockholm", "Brussels",
        "Antwerp", "Hamburg", "Munich"
      ]
    };
  }

  function recordCollectorSearch(state, incoming, searchDiagnostics = {}) {
    if (!state || state.done || state.stopRequested) return state;
    const task = nextCollectorTask(state);
    const raw = Array.isArray(incoming) ? incoming : [];
    const baseline = [...state.excluded, ...state.jobs];
    const merged = appendJobs(baseline, raw);
    let additions = merged.jobs.slice(baseline.length);
    // Berlin searches cannot accidentally satisfy their quota with a model's
    // out-of-area result. Europe searches may also find additional Berlin jobs.
    if (state.phase === "berlin") additions = additions.filter(isBerlinJob);
    state.jobs.push(...additions);
    state.diagnostics.searchCallsExecuted++;
    state.diagnostics[state.phase === "berlin" ? "berlinSearchCalls" : "europeSearchCalls"]++;
    state.diagnostics.rawCandidatesFound += Number(searchDiagnostics.rawJobsReturned ?? searchDiagnostics.candidatesFound ?? raw.length) || 0;
    state.diagnostics.verifiedCandidates += Number(searchDiagnostics.verifiedJobs ?? raw.length) || 0;
    state.diagnostics.duplicatesRemoved += (Number(searchDiagnostics.duplicatesRemoved) || 0) + raw.length - additions.length;
    if (!state.diagnostics.careerMapJobCardsUsed.includes(task.direction)) state.diagnostics.careerMapJobCardsUsed.push(task.direction);

    const berlinCount = state.jobs.filter(isBerlinJob).length;
    if (state.jobs.length >= state.targetTotal && berlinCount >= state.targetBerlin) {
      state.done = true; state.stopReason = "TARGET_REACHED";
    } else if (state.jobs.length >= state.targetTotal && berlinCount < state.targetBerlin && state.phase === "europe") {
      // Once the total target is met, spend only the reserved safety budget on
      // Berlin rather than continuing broad European searches.
      state.phase = "berlin"; state.directionIndex = 0; state.berlinTopUp = true;
    } else if (state.berlinTopUp && state.diagnostics.searchCallsExecuted >= state.maxSearchCalls) {
      state.done = true; state.stopReason = "SEARCH_BUDGET_EXHAUSTED";
    } else if (state.phase === "berlin" && berlinCount >= state.targetBerlin) {
      state.phase = "europe"; state.directionIndex = 0;
    } else {
      state.directionIndex++;
      if (state.directionIndex >= state.directions.length) {
        if (state.phase === "berlin" && !state.berlinTopUp) { state.phase = "europe"; state.directionIndex = 0; }
        else { state.done = true; state.stopReason = "SEARCH_BUDGET_EXHAUSTED"; }
      }
    }
    return state;
  }

  function requestCollectorStop(state) {
    if (!state || state.done) return state;
    state.stopRequested = true;
    state.done = true;
    state.stopReason = "USER_REQUESTED";
    return state;
  }

  function collectorResult(state) {
    const berlin = state.jobs.filter(isBerlinJob);
    const elsewhere = state.jobs.filter(job => !isBerlinJob(job));
    return [...berlin.slice(0, JOB_TARGET_BERLIN), ...berlin.slice(JOB_TARGET_BERLIN), ...elsewhere].slice(0, JOB_TARGET_TOTAL);
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

  root.JobFlow = Object.freeze({ canonicalUrl, identityKeys, dedupeJobs, appendJobs, combineAppendRounds, createJobCollector, nextCollectorTask, recordCollectorSearch, requestCollectorStop, collectorResult, isBerlinJob, invalidateStaleSearch, pollBackgroundJob });
})(globalThis);
