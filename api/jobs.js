import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { buildSearchProfile, compactExclusions, PUBLIC_JOB_ERROR, withRateLimitRetry } from "./job-search-utils.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const system = `
Du bist ein fokussiertes Live-Websuchwerkzeug für konkrete Einstiegsstellen. Die Career Map hat die Karriereanalyse bereits abgeschlossen.

Suche ausschließlich für die übergebene Career-Map-Richtung und die übergebenen Standorte. Nutze den exakten Titel und höchstens vier offensichtliche Einstiegsvarianten (Intern/Praktikum, Assistant, Coordinator, Junior). Leite keine neuen Branchen, Persönlichkeitsmerkmale oder abstrakten Karrierepfade her.

REGELN
- Nutze zwingend die Websuche und öffne konkrete Ausschreibungsseiten.
- Gib nur echte, aktuell erreichbare Einzelanzeigen mit konkreter URL zurück; keine Suchseiten, erfundenen Stellen oder geschlossenen Anzeigen.
- Geeignet sind Internship, Praktikum, Working Student, Assistant, Coordinator, Junior und Entry Level; keine Senior-, Lead- oder Head-Rollen.
- Eine fehlende Datumsangabe ist kein Ausschlussgrund, wenn die konkrete Anzeige erkennbar aktiv ist.
- Die Ausschlussliste sperrt nur dieselbe normalisierte URL oder exakt Unternehmen+Titel+Ort. Andere Stellen desselben Unternehmens bleiben erlaubt.
- Suche klein und fokussiert. Das Sammeln, Verifizieren, Deduplizieren und Erreichen des Batch-Ziels übernimmt die Anwendung.
- Beschreibe Aufgaben und Profilbezug knapp und ausschließlich anhand der Rollenrichtung und der Ausschreibung.
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
    excludeCount: Array.isArray(req.body?.exclude) ? req.body.exclude.length : 0,
    existingJobsCount: Math.max(0, Number(req.body?.existingJobsCount) || 0),
    searchStarted: req.method === "POST"
  });

  if (req.method !== "POST") {
    log("response_sent", { httpStatus: 405 });
    return res.status(405).json({
      status: "error", code: "method_not_allowed", message: "Diese Anfrage wird nicht unterstützt."
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY fehlt");
    }

    const profile = req.body?.profile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return res.status(400).json({ status: "error", code: "invalid_profile", message: "Für die Live-Suche wird eine fertige Career Map benötigt." });
    }

    const searchProfile = buildSearchProfile(profile);
    const exclude = compactExclusions(req.body?.exclude);
    const directions = searchProfile.search_strategy.careerDirections;
    const requestedTask = req.body?.searchTask;
    const direction = String(requestedTask?.direction || "").trim();
    const phase = requestedTask?.phase === "europe" ? "europe" : "berlin";
    if (!direction || !directions.includes(direction)) {
      return res.status(400).json({ status: "error", code: "invalid_search_task", message: "Die Suchrichtung gehört nicht zur Career Map." });
    }
    const locations = phase === "berlin" ? ["Berlin"] : searchProfile.search_strategy.cities.europe;
    const titleFamily = searchProfile.search_strategy.jobTitleFamilyBriefs.find(item => item.direction === direction);

    const today = new Date().toISOString().slice(0, 10);
    const searchMode = `collector_${phase}`;
    log("openai_create_started", { searchMode, direction, locations, existingJobsCount: Math.max(0, Number(req.body?.existingJobsCount) || 0), excludeCount: exclude.length });

    const requestId = String(req.body?.searchRequestId || randomUUID()).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 200);
    const response = await withRateLimitRetry(() => client.responses.create({
      model: "gpt-5.6-terra",

      reasoning: {
        effort: "low"
      },

      background: true,
      store: true,
      metadata: { search_mode: searchMode, career_direction: direction.slice(0, 500), collector_phase: phase },

      tools: [
        {
          type: "web_search",
          search_context_size: "medium",
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
              },
              search_diagnostics: {
                type: "object",
                additionalProperties: false,
                properties: {
                  careerDirectionsUsed: { type: "array", items: { type: "string" } },
                  generatedJobTitleFamilies: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        direction: { type: "string" },
                        titles: { type: "array", items: { type: "string" } }
                      },
                      required: ["direction", "titles"]
                    }
                  },
                  citiesSearched: { type: "array", items: { type: "string" } },
                  queriesExecuted: { type: "array", items: { type: "string" } },
                  searchLevelsUsed: { type: "integer", minimum: 1, maximum: 3 },
                  candidatesFound: { type: "integer", minimum: 0 },
                  duplicatesRemoved: { type: "integer", minimum: 0 },
                  rejectedByCareerFit: { type: "integer", minimum: 0 }
                },
                required: ["careerDirectionsUsed", "generatedJobTitleFamilies", "citiesSearched", "queriesExecuted", "searchLevelsUsed", "candidatesFound", "duplicatesRemoved", "rejectedByCareerFit"]
              }
            },
            required: [
              "checked_at",
              "jobs",
              "search_diagnostics"
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
            `HEUTIGES DATUM: ${today}\n\nCAREER-MAP-JOBCARD: ${direction}\n` +
            `OFFENSICHTLICHE TITELVARIANTEN: ${JSON.stringify(titleFamily?.nearTitles || [])}\n` +
            `STANDORTE: ${JSON.stringify(locations)}\n\n` +
            `BEREITS GEFUNDENE KONKRETE STELLEN: ${JSON.stringify(exclude)}\n\n` +
            "Finde in dieser einen kleinen Recherche möglichst mehrere aktuelle konkrete Ausschreibungen. Die Anwendung sucht danach bei Bedarf mit der nächsten Jobcard weiter."
        }
      ],

      max_output_tokens: 4000
    }, {
      headers: { "Idempotency-Key": `jobs-${requestId}` }
    }), {
      attempts: 5,
      onRetry: ({ attempt, delay }) => log("openai_rate_limit_retry", { attempt, delayMs: delay })
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
      status: response.status || "queued",
      searchMode,
      direction,
      phase
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

    return res.status(503).json(PUBLIC_JOB_ERROR);
  }
}
