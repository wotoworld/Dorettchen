import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY fehlt");
    }

    const jobId = req.query?.jobId;

    if (!jobId) {
      return res.status(400).json({
        error: "Missing jobId"
      });
    }

    const response = await client.responses.retrieve(jobId);

    const status = response.status;

    if (status === "completed") {
      let result;

      try {
        result = JSON.parse(response.output_text || "");
      } catch {
        return res.status(500).json({
          status: "error",
          error:
            "Die Analyse wurde abgeschlossen, konnte aber nicht als gültiges JSON gelesen werden."
        });
      }

      return res.status(200).json({
        status: "complete",
        result
      });
    }

    if (
      status === "failed" ||
      status === "cancelled" ||
      status === "incomplete"
    ) {
      const message =
        response.error?.message ||
        response.incomplete_details?.reason ||
        `Analyse ${status}.`;

      return res.status(200).json({
        status: "error",
        error: message
      });
    }

    return res.status(200).json({
      status: status || "in_progress"
    });

  } catch (error) {
    console.error("ANALYZE STATUS ERROR:", error);

    return res.status(500).json({
      status: "error",
      error:
        error.message || "Status konnte nicht abgefragt werden."
    });
  }
}
