import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const system = `
Du bist ein Live-Praktikums- und Job-Finder für eine Career-Discovery-App.

Deine Aufgabe:
Finde 12 bis 15 AKTUELL auffindbare Praktika oder Junior-Stellen, die möglichst gut zum übergebenen Career-Profil passen.

WICHTIG:
- Nutze zwingend die Websuche.
- Suche live im Internet.
- Bevorzuge offizielle Karriere-/Bewerbungsseiten von Unternehmen und seriöse Jobplattformen.
- Gib nur Stellen zurück, deren konkrete Ausschreibung du tatsächlich in der Websuche gefunden hast.
- Erfinde niemals Unternehmen, Stellen, URLs oder Anforderungen.
- Bevorzuge ausgeschriebene, aktuell erreichbare Stellen.
- Wenn du erkennst, dass eine Ausschreibung geschlossen oder abgelaufen ist, gib sie nicht zurück.
- Wenn kein konkreter Bewerbungslink auffindbar ist, gib die Stelle nicht zurück.
- Suche nicht nur nach exakt einem Beruf, sondern nach mehreren passenden Richtungen aus dem Profil.
- Berücksichtige insbesondere Standort, Branche, Kreativität, Menschenkontakt, Events, Design, Kunst, Reisen, Marken, Kommunikation, Strategie und Internationalität, soweit sie zum Profil passen.
- Wenn der Standort im Profil fehlt, bevorzuge Berlin und danach andere große europäische Städte.
- Erkläre bei jeder Stelle kurz, warum sie zum Profil passt.
- Verwende das heutige Datum und behandle Aktualität als wichtig.
- Wenn bereits gefundene Stellen übergeben wurden, gib diese nicht erneut zurück. Suche stattdessen andere konkrete Ausschreibungen.

Gib ausschließlich valides JSON zurück:

{
  "checked_at": "YYYY-MM-DD",
  "jobs": [
    {
      "title": "...",
      "company": "...",
      "location": "...",
      "type": "Praktikum",
      "url": "https://...",
      "description": "...",
      "why_fit": "...",
      "source": "..."
    }
  ]
}

Die URL muss direkt zu der gefundenen Ausschreibung oder zur konkreten Bewerbungsseite führen.
`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const profile = req.body?.profile || {};

    const exclude = Array.isArray(req.body?.exclude)
      ? req.body.exclude.filter(Boolean).slice(0, 100)
      : [];

    const r = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
      reasoning: {
        effort: "high"
      },
      tools: [
        {
          type: "web_search",
          search_context_size: "high",
          user_location: {
            type: "approximate",
            country: "AT",
            city: "Vienna",
            timezone: "Europe/Vienna"
          }
        }
      ],
      tool_choice: "required",
      input: [
        {
          role: "system",
          content: system
        },
        {
          role: "user",
          content:
            "Hier ist das Career-Profil:\n\n" +
            JSON.stringify(profile) +
            "\n\nBereits gefundene Stellen, die NICHT erneut zurückgegeben werden sollen:\n" +
            JSON.stringify(exclude) +
            "\n\nSuche jetzt live nach weiteren passenden aktuellen Stellen."
        }
      ]
    });

    const result = JSON.parse(r.output_text);

    if (!Array.isArray(result.jobs)) {
      throw new Error("Ungültiges Stellenformat");
    }

    result.jobs = result.jobs
      .filter(j => j && j.title && j.company && j.url)
      .slice(0, 15);

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Live-Stellensuche fehlgeschlagen."
    });
  }
}
