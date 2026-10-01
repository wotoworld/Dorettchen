import OpenAI from "openai";
import { compactProfile, normalizeJobUrl } from "../lib/jobs.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_JOBS_MODEL || "gpt-5.6-sol";

const instructions = `Du recherchierst reale, derzeit offene Einstiegsstellen für eine Career-Discovery-App.
Nutze zwingend die Live-Websuche. Jede ausgegebene Stelle muss eine konkrete, aktuell erreichbare Stellenanzeige sein. Erfinde niemals Titel, Unternehmen, Beschreibungen oder URLs. Gib keine Suchseiten, Unternehmens-Startseiten, Talent-Pools, abgelaufenen Anzeigen oder unklar verifizierbaren Treffer aus. Bevorzuge direkte Karriere- und Bewerbungsseiten; seriöse Jobbörsen sind erlaubt.

Leite Suchrichtungen ausschließlich aus der übergebenen Career Map ab: Berufsfelder, Interessen, Stärken, Arbeitsweise, Branchen, Umfeld und Standortwünsche. Suche nach Praktika/Internships, passenden Traineeships und sinnvollen Junior-/Entry-Level-Rollen. Priorisiere Berlin, sofern das Profil nichts Gegenteiliges sagt; danach passende europäische Städte. Prüfe die Ausschreibung mit Web Search vor der Ausgabe. Liefere lieber wenige verifizierte Treffer als unsichere. Bereits ausgeschlossene URLs dürfen nicht wiederkehren. "why_fit" muss konkret auf Informationen aus der Career Map Bezug nehmen, ohne neue Profildaten zu erfinden. "source" nennt die Website/Quelle der konkreten Anzeige.`;

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    checked_at: { type: "string" },
    jobs: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: {
        title: { type: "string" }, company: { type: "string" }, location: { type: "string" },
        type: { type: "string" }, url: { type: "string" }, description: { type: "string" },
        why_fit: { type: "string" }, source: { type: "string" }
      },
      required: ["title", "company", "location", "type", "url", "description", "why_fit", "source"]
    }}
  },
  required: ["checked_at", "jobs"]
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "Die Live-Suche ist serverseitig noch nicht konfiguriert." });

  const profile = compactProfile(req.body?.profile);
  if (!Object.keys(profile).length) return res.status(400).json({ error: "Für die Suche wird zuerst eine Career Map benötigt." });
  const exclude = (Array.isArray(req.body?.exclude) ? req.body.exclude : [])
    .map(normalizeJobUrl).filter(Boolean).slice(0, 150);

  try {
    const response = await client.responses.create({
      model: MODEL,
      background: true,
      store: true,
      reasoning: { effort: "medium" },
      tools: [{
        type: "web_search",
        external_web_access: true,
        search_context_size: "high",
        user_location: { type: "approximate", country: "DE", city: "Berlin", timezone: "Europe/Berlin" }
      }],
      tool_choice: "required",
      text: { format: { type: "json_schema", name: "verified_job_search", strict: true, schema } },
      input: [
        { role: "system", content: instructions },
        { role: "user", content: `Datum: ${new Date().toISOString().slice(0, 10)}\n\nCAREER MAP:\n${JSON.stringify(profile).slice(0, 30000)}\n\nAUSGESCHLOSSENE URLS:\n${JSON.stringify(exclude)}\n\nFinde bis zu 8 weitere verifizierte Stellen.` }
      ],
      max_output_tokens: 6000
    });
    return res.status(202).json({ searchId: response.id, status: response.status || "queued" });
  } catch (error) {
    console.error("JOB SEARCH START ERROR", error);
    return res.status(502).json({ error: "Die Live-Stellensuche konnte nicht gestartet werden." });
  }
}
