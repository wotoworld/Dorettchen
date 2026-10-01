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
        status: "error",
        error: "Missing jobId"
      });
    }

    const response = await client.responses.retrieve(jobId);

    console.log("JOBS STATUS:", {
      id: response.id,
      status: response.status,
      error: response.error,
      incomplete_details: response.incomplete_details
    });

    if (
      response.status === "queued" ||
      response.status === "in_progress"
    ) {
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

        return res.status(200).json({
          status: "error",
          error:
            "Die Stellensuche wurde abgeschlossen, hat aber kein Ergebnis geliefert."
        });
      }

      let result;

      try {
        result = JSON.parse(text);
      } catch (error) {
        console.error("JOBS JSON PARSE ERROR:", text);

        return res.status(200).json({
          status: "error",
          error:
            "Die Stellensuche hat kein gültiges Ergebnis zurückgegeben."
        });
      }

      if (!result || !Array.isArray(result.jobs)) {
        return res.status(200).json({
          status: "error",
          error:
            "Das Ergebnis der Stellensuche ist ungültig."
        });
      }

      result.jobs = result.jobs
        .filter(job =>
          job &&
          typeof job === "object" &&
          typeof job.title === "string" &&
          typeof job.company === "string" &&
          typeof job.url === "string" &&
          job.url.startsWith("http")
        )
        .slice(0, 15);

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

      return res.status(200).json({
        status: "error",
        error:
          response.error?.message ||
          response.last_error?.message ||
          "Die Live-Stellensuche ist fehlgeschlagen."
      });
    }

    if (response.status === "cancelled") {
      return res.status(200).json({
        status: "error",
        error:
          "Die Live-Stellensuche wurde abgebrochen."
      });
    }

    if (response.status === "incomplete") {
      return res.status(200).json({
        status: "error",
        error:
          response.incomplete_details?.reason ||
          "Die Live-Stellensuche wurde nicht vollständig abgeschlossen."
      });
    }

    return res.status(200).json({
      status: response.status || "queued"
    });

  } catch (error) {
    console.error("JOBS STATUS ERROR:", error);

    return res.status(500).json({
      status: "error",
      error:
        error.message ||
        "Der Status der Stellensuche konnte nicht abgerufen werden."
    });
  }
}
