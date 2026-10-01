const ALLOWED_METRICS = [
  "existingJobsCount", "excludeCount", "searchRound", "candidatesFound",
  "candidatesVerified", "candidatesRejected", "duplicatesRemoved", "newJobsReturned",
  "existingJobsBeforeAppend", "newJobsAppended", "totalJobsAfterAppend", "pollCount"
];

const ALLOWED_TEXT = ["openAIStatus", "pollingOutcome"];

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ status: "error" });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const metrics = Object.fromEntries(ALLOWED_METRICS
    .filter(key => Number.isFinite(Number(body[key])))
    .map(key => [key, Number(body[key])]));
  console.log("[JOBS_DIAGNOSTIC]", JSON.stringify({
    flowId: String(body.flowId || "missing").slice(0, 200),
    endpoint: "/api/jobs-diagnostics",
    stage: String(body.stage || "client_update").slice(0, 80),
    at: new Date().toISOString(),
    ...Object.fromEntries(ALLOWED_TEXT.filter(key => body[key]).map(key => [key, String(body[key]).slice(0, 80)])),
    ...metrics
  }));
  return res.status(204).end();
}
