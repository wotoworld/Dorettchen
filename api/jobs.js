import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const system = `
Du bist der SEARCH-Schritt einer Live-Praktikums- und Job-Pipeline. Danach prüft der Server jede konkrete Seite (VERIFY → FILTER → RANK → RENDER).

DEINE AUFGABE
Finde konkrete, aktuell auffindbare Praktika oder Junior-Stellen, die möglichst gut zum übergebenen Career-Profil passen.

Die Suche muss auf einer echten Live-Websuche basieren.

WICHTIG:
- Nutze zwingend die Websuche.
- Suche wirklich im aktuellen Internet.
- Verwende keine erfundenen Stellen.
- Verwende keine erfundenen Unternehmen.
- Verwende keine erfundenen URLs.
- Gib nur Stellen zurück, deren konkrete Ausschreibung du tatsächlich über die Websuche gefunden hast.
- Bevorzuge direkte Bewerbungsseiten.
- Seriöse Jobplattformen sind ebenfalls erlaubt.
- Öffne jeden Treffer in der Websuche und prüfe die KONKRETE Ausschreibungsseite; ein Suchsnippet allein genügt nie.
- Wenn eine Stelle geschlossen, abgelaufen, entfernt oder nicht mehr bewerbbar ist, gib sie nicht zurück.
- Bevorzuge direkte Unternehmensseiten und ATS wie Greenhouse, Lever, Workday, Personio, JOIN und SmartRecruiters.
- Wenn keine konkrete Bewerbungsseite oder konkrete Ausschreibung auffindbar ist, gib die Stelle nicht zurück.
- Suche mehrere Richtungen, die zum Career-Profil passen.
- Berücksichtige Interessen, Fähigkeiten, Arbeitsweisen, Brancheninteressen und Standortpräferenzen.
- Wenn Berlin als Standortpräferenz vorhanden ist, suche zuerst in Berlin.
- Recherchiere breit über mehrere Career-Map-Richtungen. Ziel sind 55–70 % Berlin und – sofern qualitativ möglich – mindestens fünf weitere passende europäische Städte (z. B. Amsterdam, Copenhagen, London, Milan, Barcelona, Madrid, Paris, Lisbon, Vienna, Stockholm, Antwerp).
- Verwende das aktuelle Datum.
- Ein belastbares Veröffentlichungs-/Aktualisierungsdatum darf höchstens 30 Tage zurückliegen. Erfinde kein Datum. Fehlt es, muss eine aktive Bewerbungsfunktion eindeutig sichtbar sein.
- Liefere 3–5 informative Sätze zu konkreten Aufgaben, Team/Projekt und Branche sowie einen spezifischen Profilbezug, ausschließlich aus vorhandenen Profildaten.

BEREITS GEFUNDENE STELLEN
Bereits gefundene Stellen dürfen NICHT erneut zurückgegeben werden.
Vergleiche insbesondere URL, Unternehmen und Stellentitel.

QUALITÄT
Ermittle bis zu 30 gute Kandidaten, damit nach der technischen Verifikation 10–15 übrig bleiben können. Gib lieber weniger zurück als zweifelhafte Treffer.
`;

export default async function handler(req, res) {
  const flowId = req.body?.diagnosticFlowId || req.headers["x-diagnostic-flow-id"] || "missing";
  const log = (stage, details = {}) => console.log("[JOBS_DIAGNOSTIC]", JSON.stringify({
    flowId,
    endpoint: "/api/jobs",
    stage,
    at: new Date().toISOString(),
    ...details
  }));

  log("request_received", {
    method: req.method,
    hasProfile: Boolean(req.body?.profile),
    excludeCount: Array.isArray(req.body?.exclude) ? req.body.exclude.length : 0
  });

  if (req.method !== "POST") {
    log("response_sent", { httpStatus: 405 });
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY fehlt");
    }

    const profile = req.body?.profile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return res.status(400).json({ error: "Für die Live-Suche wird eine fertige Career Map benötigt." });
    }

    const exclude = Array.isArray(req.body?.exclude)
      ? req.body.exclude.filter(Boolean).slice(0, 100)
      : [];

    const today = new Date().toISOString().slice(0, 10);

    log("openai_create_started");

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-sol",

      reasoning: {
        effort: "high"
      },

      background: true,
      store: true,

      tools: [
        {
          type: "web_search",
          search_context_size: "high",
          user_location: {
            type: "approximate",
            country: "DE",
            city: "Berlin",
            timezone: "Europe/Berlin"
          }
        }
      ],

      tool_choice: "required",

      text: {
        format: {
          type: "json_schema",
          name: "job_search_result",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              checked_at: {
                type: "string"
              },
              jobs: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: {
                      type: "string"
                    },
                    company: {
                      type: "string"
                    },
                    location: {
                      type: "string"
                    },
                    type: {
                      type: "string"
                    },
                    url: {
                      type: "string"
                    },
                    description: {
                      type: "string"
                    },
                    why_fit: {
                      type: "string"
                    },
                    source: {
                      type: "string"
                    },
                    published_at: {
                      type: ["string", "null"]
                    },
                    fit_score: {
                      type: "number"
                    }
                  },
                  required: [
                    "title",
                    "company",
                    "location",
                    "type",
                    "url",
                    "description",
                    "why_fit",
                    "source",
                    "published_at",
                    "fit_score"
                  ]
                }
              }
            },
            required: [
              "checked_at",
              "jobs"
            ]
          }
        }
      },

      input: [
        {
          role: "system",
          content: system
        },
        {
          role: "user",
          content:
            "HEUTIGES DATUM:\n" +
            today +
            "\n\nCAREER-PROFIL:\n" +
            JSON.stringify(profile) +
            "\n\nBEREITS GEFUNDENE STELLEN, DIE NICHT ERNEUT AUSGEGEBEN WERDEN DÜRFEN:\n" +
            JSON.stringify(exclude) +
            "\n\nSuche jetzt live im Internet nach weiteren passenden aktuellen Stellen."
        }
      ],

      max_output_tokens: 7000
    });

    log("openai_create_succeeded", {
      responseId: response.id,
      responseStatus: response.status,
      error: response.error || null,
      incompleteDetails: response.incomplete_details || null
    });

    log("response_sent", {
      httpStatus: 202,
      jobId: response.id,
      status: response.status || "queued"
    });
    return res.status(202).json({
      jobId: response.id,
      status: response.status || "queued"
    });

  } catch (error) {
    console.error("[JOBS_DIAGNOSTIC]", JSON.stringify({
      flowId,
      endpoint: "/api/jobs",
      stage: "error",
      at: new Date().toISOString(),
      error: {
        name: error?.name,
        message: error?.message,
        status: error?.status,
        code: error?.code,
        requestId: error?.request_id
      }
    }));

    return res.status(500).json({
      error:
        error.message ||
        "Die Live-Stellensuche konnte nicht gestartet werden."
    });
  }
}
