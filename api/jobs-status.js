import OpenAI from "openai";
import { rankForLocationMix, verifyJobs } from "./job-verification.js";
import { PUBLIC_JOB_ERROR, withRateLimitRetry } from "./job-search-utils.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  const flowId = req.query?.diagnosticFlowId || req.headers["x-diagnostic-flow-id"] || "missing";
  const jobId = req.query?.jobId;
  const log = (stage, details = {}) => console.log("[JOBS_DIAGNOSTIC]", JSON.stringify({
    flowId,
    endpoint: "/api/jobs-status",
    stage,
    at: new Date().toISOString(),
    jobId: jobId || null,
    ...details
  }));

  log("request_received", { method: req.method });

  if (req.method !== "GET") {
    log("response_sent", { httpStatus: 405 });
    return res.status(405).json({
      status: "error", code: "method_not_allowed", message: "Diese Anfrage wird nicht unterstützt."
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY fehlt");
    }

    if (!jobId) {
      log("response_sent", { httpStatus: 400, status: "error" });
      return res.status(400).json({
        status: "error",
        code: "invalid_request",
        message: "Die Live-Suche konnte nicht zugeordnet werden."
      });
    }

    log("openai_retrieve_started");
    const response = await withRateLimitRetry(() => client.responses.retrieve(jobId), {
      attempts: 5,
      onRetry: ({ attempt, delay }) => log("openai_rate_limit_retry", { attempt, delayMs: delay })
    });

    log("openai_retrieve_succeeded", {
      responseId: response.id,
      responseStatus: response.status,
      error: response.error || null,
      incompleteDetails: response.incomplete_details || null,
      output: response.status === "completed" ? response.output : undefined,
      outputText: response.status === "completed" ? response.output_text : undefined
    });

    if (
      response.status === "queued" ||
      response.status === "in_progress"
    ) {
      log("response_sent", { httpStatus: 200, status: response.status });
      return res.status(200).json({
        status: response.status
      });
    }

    if (response.status === "completed") {

      // Normaler Convenience-Wert der Responses API
      const text = response.output_text;

      if (!text) {
        console.error(
          "JOBS EMPTY OUTPUT:",
          JSON.stringify(response.output)
        );

        log("response_sent", { httpStatus: 500, status: "error", reason: "empty_output" });
        return res.status(500).json(PUBLIC_JOB_ERROR);
      }

      let result;

      try {
        result = JSON.parse(text);
      } catch (error) {
        console.error("JOBS JSON PARSE ERROR:", text);

        log("response_sent", { httpStatus: 500, status: "error", reason: "invalid_json" });
        return res.status(500).json(PUBLIC_JOB_ERROR);
      }

      if (!result || !Array.isArray(result.jobs)) {
        log("response_sent", { httpStatus: 500, status: "error", reason: "invalid_result_shape" });
        return res.status(500).json(PUBLIC_JOB_ERROR);
      }

      const candidates = result.jobs
        .filter(job =>
          job &&
          typeof job === "object" &&
          typeof job.title === "string" &&
          typeof job.company === "string" &&
          typeof job.url === "string" &&
          job.url.startsWith("http")
        )
        .slice(0, 30);

      // Search results are candidates only: open and inspect every concrete listing
      // before filtering, ranking and returning anything to the browser.
      result.jobs = rankForLocationMix(await verifyJobs(candidates), 15);
      result.checked_at = new Date().toISOString();

      log("response_sent", {
        httpStatus: 200,
        status: "complete",
        resultJobCount: result.jobs.length
      });
      return res.status(200).json({
        status: "complete",
        result
      });
    }

    if (response.status === "failed") {
      console.error(
        "JOBS FAILED:",
        JSON.stringify(response.error || response.last_error)
      );

      log("response_sent", { httpStatus: 500, status: "error", reason: "openai_failed" });
      return res.status(503).json(PUBLIC_JOB_ERROR);
    }

    if (response.status === "cancelled") {
      log("response_sent", { httpStatus: 500, status: "error", reason: "openai_cancelled" });
      return res.status(503).json(PUBLIC_JOB_ERROR);
    }

    if (response.status === "incomplete") {
      log("response_sent", {
        httpStatus: 500,
        status: "error",
        reason: "openai_incomplete",
        incompleteDetails: response.incomplete_details || null
      });
      return res.status(503).json(PUBLIC_JOB_ERROR);
    }

    log("response_sent", { httpStatus: 200, status: response.status || "queued" });
    return res.status(200).json({
      status: response.status || "queued"
    });

  } catch (error) {
    console.error("[JOBS_DIAGNOSTIC]", JSON.stringify({
      flowId,
      endpoint: "/api/jobs-status",
      stage: "error",
      at: new Date().toISOString(),
      jobId: jobId || null,
      error: {
        name: error?.name,
        message: error?.message,
        status: error?.status,
        code: error?.code,
        requestId: error?.request_id
      }
    }));

    return res.status(503).json(PUBLIC_JOB_ERROR);
  }
}
