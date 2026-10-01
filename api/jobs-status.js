import OpenAI from "openai";
import { sanitizeJobs } from "../lib/jobs.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ status: "error", error: "Die Live-Suche ist serverseitig noch nicht konfiguriert." });
  const searchId = typeof req.query?.searchId === "string" ? req.query.searchId : "";
  if (!/^resp_[A-Za-z0-9_-]+$/.test(searchId)) return res.status(400).json({ status: "error", error: "Ungültige Such-ID." });

  try {
    const response = await client.responses.retrieve(searchId);
    if (response.status === "queued" || response.status === "in_progress") return res.status(200).json({ status: response.status });
    if (response.status !== "completed") {
      const detail = response.error?.message || response.incomplete_details?.reason;
      console.error("JOB SEARCH TERMINAL STATUS", response.status, detail);
      return res.status(502).json({ status: "error", error: "Die Live-Stellensuche wurde nicht erfolgreich abgeschlossen." });
    }
    if (!response.output_text) return res.status(502).json({ status: "error", error: "Die Suche hat keine auswertbaren Ergebnisse geliefert." });
    let parsed;
    try { parsed = JSON.parse(response.output_text); }
    catch { return res.status(502).json({ status: "error", error: "Das Suchergebnis konnte nicht ausgewertet werden." }); }
    return res.status(200).json({
      status: "complete",
      result: { checked_at: parsed.checked_at || new Date().toISOString(), jobs: sanitizeJobs(parsed.jobs) }
    });
  } catch (error) {
    console.error("JOB SEARCH STATUS ERROR", error);
    return res.status(502).json({ status: "error", error: "Der Status der Live-Suche konnte nicht geladen werden." });
  }
}
