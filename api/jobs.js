import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { buildRoundDirective, buildSearchProfile, compactExclusions, MAX_SEARCH_ROUNDS, PUBLIC_JOB_ERROR, withRateLimitRetry } from "./job-search-utils.js";

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
- Sammle Kandidaten effizient und ohne redundante Suchen. Öffne nur vielversprechende Treffer, prüfe dabei die KONKRETE Ausschreibungsseite; ein Suchsnippet allein genügt nie. Verwende bereits gefundene Fakten wieder, statt dieselbe Information erneut zu suchen.
- Wenn eine Stelle geschlossen, abgelaufen, entfernt oder nicht mehr bewerbbar ist, gib sie nicht zurück.
- Bevorzuge direkte Unternehmensseiten und ATS wie Greenhouse, Lever, Workday, Personio, JOIN und SmartRecruiters.
- Wenn keine konkrete Bewerbungsseite oder konkrete Ausschreibung auffindbar ist, gib die Stelle nicht zurück.
- Suche mehrere Richtungen, die zum Career-Profil passen.
- Berücksichtige Interessen, Fähigkeiten, Arbeitsweisen, Brancheninteressen und Standortpräferenzen.
- Wenn Berlin als Standortpräferenz vorhanden ist, suche zuerst in Berlin.
- Folge der übergebenen Suchphase. In Berlin-Runden suchst du besonders gründlich über mehrere Career-Map-Richtungen; in Europa-Runden füllst du breit über passende europäische Städte auf (z. B. Amsterdam, Copenhagen, London, Milan, Barcelona, Madrid, Paris, Lisbon, Vienna, Stockholm, Antwerp).
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

    const today = new Date().toISOString().slice(0, 10);
    const searchRound = Math.min(MAX_SEARCH_ROUNDS, Math.max(1, Number(req.body?.searchRound) || 1));
    const searchPhase = req.body?.searchPhase === "europe" ? "europe" : "berlin";
    const verifiedBefore = Math.max(0, Number(req.body?.verifiedCount) || 0);
    const berlinBefore = Math.max(0, Number(req.body?.berlinCount) || 0);
    const roundDirective = buildRoundDirective({ phase: searchPhase, round: searchRound, verifiedCount: verifiedBefore, berlinCount: berlinBefore });

    log("openai_create_started", { searchRound, searchPhase, verifiedBefore, berlinBefore });

    const requestId = String(req.body?.searchRequestId || randomUUID()).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 200);
    const response = await withRateLimitRetry(() => client.responses.create({
      model: "gpt-5.6-terra",

      reasoning: {
        effort: "high"
      },

      background: true,
      store: true,
      metadata: {
        search_round: String(searchRound),
        search_phase: searchPhase,
        verified_before: String(verifiedBefore),
        berlin_before: String(berlinBefore)
      },

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
            JSON.stringify(searchProfile) +
            "\n\nBEREITS GEFUNDENE STELLEN, DIE NICHT ERNEUT AUSGEGEBEN WERDEN DÜRFEN:\n" +
            JSON.stringify(exclude) +
            "\n\nAKTUELLE SUCHRUNDE:\n" +
            roundDirective +
            "\n\nSuche jetzt live im Internet nach weiteren passenden aktuellen Stellen. Gib keine ausgeschlossenen oder bereits geprüften URLs erneut aus."
        }
      ],

      // Thirty candidates with individual descriptions need this headroom;
      // lowering it further risks truncated structured JSON.
      max_output_tokens: 7000
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

    return res.status(503).json(PUBLIC_JOB_ERROR);
  }
}
