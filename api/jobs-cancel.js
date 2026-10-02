import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", code: "method_not_allowed" });
  }

  const jobId = req.body?.jobId;
  if (!jobId || !process.env.OPENAI_API_KEY) {
    return res.status(400).json({ status: "error", code: "invalid_request" });
  }

  try {
    const response = await client.responses.cancel(jobId);
    return res.status(200).json({ status: response.status || "cancelled" });
  } catch (error) {
    // Cancellation is best-effort: a response may have completed between the
    // user's click and this request. The browser has already stopped the batch.
    console.warn("[JOBS_CANCEL]", JSON.stringify({ jobId, message: error?.message, status: error?.status }));
    return res.status(202).json({ status: "stop_recorded" });
  }
}
