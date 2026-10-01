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

    /*
     * Suche läuft noch
     */
    if (
      response.status === "queued" ||
      response.status === "in_progress"
    ) {

      return res.status(200).json({
        status: response.status
      });
    }

    /*
     * Suche fertig
     */
    if (response.status === "completed") {

      let result;

      try {

        result = JSON.parse(response.output_text);

      } catch (error) {

        return res.status(500).json({
          status: "error",
          error:
            "Die Stellensuche hat kein gültiges Ergebnis zurückgegeben."
        });
      }

      if (
        !result ||
        !Array.isArray(result.jobs)
      ) {

        return res.status(500).json({
          status: "error",
          error:
            "Das Ergebnis der Stellensuche ist ungültig."
        });
      }

      /*
       * Nur brauchbare Stellen an das Frontend weitergeben
       */
      result.jobs = result.jobs
        .filter(job =>
          job &&
          job.title &&
          job.company &&
          job.url
        )
        .slice(0, 15);

      return res.status(200).json({
        status: "complete",
        result
      });
    }

    /*
     * OpenAI Job fehlgeschlagen
     */
    if (response.status === "failed") {

      return res.status(500).json({
        status: "error",
        error:
          response.last_error?.message ||
          "Die Live-Stellensuche ist fehlgeschlagen."
      });
    }

    /*
     * Job abgebrochen
     */
    if (response.status === "cancelled") {

      return res.status(500).json({
        status: "error",
        error:
          "Die Live-Stellensuche wurde abgebrochen."
      });
    }

    /*
     * Unbekannter Zwischenstatus
     */
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
