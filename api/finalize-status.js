import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const requiredObjectKeys = [
  "career_dna",
  "profile",
  "environment"
];

const requiredArrayKeys = [
  "career_axes",
  "strengths",
  "self_reveals",
  "directions",
  "next_steps"
];

function isCareerMap(result) {
  return Boolean(
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    requiredObjectKeys.every(key =>
      result[key] && typeof result[key] === "object" && !Array.isArray(result[key])
    ) &&
    requiredArrayKeys.every(key => Array.isArray(result[key])) &&
    Array.isArray(result.career_dna.dimensions)
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY fehlt");
    }

    const jobId = req.query?.jobId;

    if (!jobId) {
      return res.status(400).json({
        status: "error",
        error: "Missing jobId"
      });
    }

    const response = await client.responses.retrieve(jobId);

    if (response.status === "completed") {
      let result;

      try {
        result = JSON.parse(response.output_text || "");
      } catch {
        return res.status(500).json({
          status: "error",
          error: "Die Career Map wurde abgeschlossen, enthält aber kein gültiges JSON."
        });
      }

      if (!isCareerMap(result)) {
        return res.status(500).json({
          status: "error",
          error: "Die fertige Career Map hat nicht die erwartete Struktur."
        });
      }

      return res.status(200).json({
        status: "complete",
        result
      });
    }

    if (
      response.status === "failed" ||
      response.status === "cancelled" ||
      response.status === "incomplete"
    ) {
      return res.status(200).json({
        status: "error",
        error:
          response.error?.message ||
          response.incomplete_details?.reason ||
          `Career Map ${response.status}.`
      });
    }

    return res.status(200).json({
      status: response.status || "in_progress"
    });
  } catch (error) {
    console.error("FINALIZE STATUS ERROR:", error);

    return res.status(500).json({
      status: "error",
      error: error.message || "Status der Career Map konnte nicht abgefragt werden."
    });
  }
}
