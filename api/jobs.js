import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const system = `
Du bist der Job-Finder für eine Career-Discovery-App.

Suche AKTUELLE, real existierende Praktikumsstellen, die zu dem übergebenen Career Profile passen könnten.
Priorität: Berlin. Ergänze nur dann andere europäische Städte, wenn die Stelle wirklich relevant ist.

WICHTIG:
- Nutze die Websuche.
- Suche nach Stellen, die aktuell auffindbar und möglichst aktuell ausgeschrieben sind.
- Bevorzuge offizielle Karriere-Seiten von Unternehmen sowie etablierte Jobbörsen.
- Erfinde niemals Unternehmen, Stellen, Fristen oder URLs.
- Eine Stelle darf nur aufgenommen werden, wenn du eine konkrete Quelle/URL gefunden hast.
- Keine endgültigen Aussagen wie "perfekt für dich". Formuliere "könnte interessant sein", weil das Profil nur eine Orientierung ist.
- Wenn du keine ausreichend verlässlichen Stellen findest, gib weniger Ergebnisse zurück statt erfundene.
- Achte besonders auf Schnittstellen aus BWL, Kunst, Design, Kultur, Events, Brand, Creative Production, Kommunikation, People, Innovation und internationalen Umfeldern, sofern das Profil diese Bereiche stützt.

Gib ausschließlich valides JSON zurück:
{
  "jobs": [
    {
      "title": "...",
      "company": "...",
      "location": "...",
      "type": "Praktikum",
      "description": "Kurze sachliche Beschreibung der Rolle und Aufgaben.",
      "why_relevant": "Warum diese Stelle zu konkreten Mustern im Profil passen könnte.",
      "deadline": "...",
      "url": "https://..."
    }
  ]
}
`;

function cleanJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  return first >= 0 && last > first ? candidate.slice(first, last + 1) : candidate;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY fehlt");

    const r = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
      reasoning: { effort: "high" },
      tools: [{ type: "web_search" }],
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            current_date: new Date().toISOString().slice(0, 10),
            preferred_city: "Berlin",
            preferred_region: "Europe",
            profile: req.body?.profile || {}
          })
        }
      ]
    });

    const parsed = JSON.parse(cleanJson(r.output_text));
    return res.status(200).json(parsed);
  } catch (error) {
    console.error("JOBS ERROR:", error);
    return res.status(500).json({ error: error.message || "Stellensuche fehlgeschlagen" });
  }
}
