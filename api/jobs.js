import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { buildSearchProfile, compactExclusions, PUBLIC_JOB_ERROR, withRateLimitRetry } from "./job-search-utils.js";

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
- Führe genau eine fokussierte Recherche durch. Sammle Kandidaten effizient und ohne redundante Suchen. Öffne nur vielversprechende Treffer, prüfe dabei die KONKRETE Ausschreibungsseite; ein Suchsnippet allein genügt nie. Verwende bereits gefundene Fakten wieder, statt dieselbe Information erneut zu suchen.
- Wenn eine Stelle geschlossen, abgelaufen, entfernt oder nicht mehr bewerbbar ist, gib sie nicht zurück.
- Bevorzuge direkte Unternehmensseiten und ATS wie Greenhouse, Lever, Workday, Personio, JOIN und SmartRecruiters.
- Wenn keine konkrete Bewerbungsseite oder konkrete Ausschreibung auffindbar ist, gib die Stelle nicht zurück.
- Suche mehrere Richtungen, die zum Career-Profil passen.
- Berücksichtige Interessen, Fähigkeiten, Arbeitsweisen, Brancheninteressen und Standortpräferenzen.
- Priorisiere Berlin, fülle aber zügig mit passenden europäischen Städten auf (z. B. Amsterdam, Copenhagen, London, Milan, Barcelona, Madrid, Paris, Lisbon, Vienna, Stockholm, Antwerp), wenn dort nicht genug hochwertige Treffer verfügbar sind.
- Verwende das aktuelle Datum.
- Ein belastbares Veröffentlichungs-/Aktualisierungsdatum darf höchstens 30 Tage zurückliegen. Erfinde kein Datum. Fehlt es, muss eine aktive Bewerbungsfunktion eindeutig sichtbar sein.
- Liefere 3–5 informative Sätze zu konkreten Aufgaben, Team/Projekt und Branche sowie einen spezifischen Profilbezug, ausschließlich aus vorhandenen Profildaten.

BEREITS GEFUNDENE STELLEN
Die Ausschlussliste beschreibt ausschließlich konkrete Stellenidentitäten. Schließe primär dieselbe normalisierte URL aus, sekundär exakt dieselbe Kombination aus Unternehmen, Titel und Standort. Unternehmen, Domain, Stadt, Jobfamilie oder Career Direction bleiben ausdrücklich durchsuchbar. Eine andere Stelle beim selben Unternehmen ist erlaubt.

`;

const initialDirective = `
INITIALSUCHE – ERGEBNISZIEL
Liefere 12–15 hochwertige konkrete Stellen in diesem einen Suchlauf und höre dann sofort auf. Priorisiere Berlin mit dem Ziel von mindestens 7 Treffern. Die Zahl 12 ist keine harte Mindestbedingung: Sind nach vernünftiger Suche nur 10 oder 11 gute Treffer auffindbar, gib sie sofort zurück. Qualität geht vor Anzahl.`;

const appendDirective = round => round === 2 ? `
APPEND SEARCH – ROUND 2 (EXPANDED SEARCH)
Finde neue Stellen, um insgesamt mindestens 6 neue verifizierbare Treffer dieses Klicks zu erreichen. Suche breiter: zusätzliche passende Titel und Synonyme, angrenzende Career Directions, weitere europäische Städte, Unternehmen und seriöse Jobquellen. Berlin bleibt erste Priorität, aber fülle zügig europaweit auf. Prüfe keine ausgeschlossene konkrete URL erneut. Gib alle belastbaren Treffer sofort zurück; Qualität geht vor Zielzahl.` : `
APPEND SEARCH – ROUND 1 (PRIMARY SEARCH)
Finde mindestens 6 NEUE verifizierbare Stellen. Die Ausschlussliste zählt nicht zum Ziel. Suche mit Career-Map-Fit, Berlin zuerst und danach passenden europäischen Städten unter allen bestehenden Qualitätsregeln. Höre bei mindestens 6 guten Kandidaten sofort auf. Eine andere Stelle eines bereits vertretenen Unternehmens ist ausdrücklich erlaubt.`;

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
    const append = req.body?.append === true;
    const searchRound = append && Number(req.body?.searchRound) === 2 ? 2 : 1;

    const today = new Date().toISOString().slice(0, 10);
    const searchMode = append ? `append_round_${searchRound}` : "initial_search";
    log("openai_create_started", { searchMode, searchRound, existingJobsCount: Math.max(0, Number(req.body?.existingJobsCount) || 0), excludeCount: exclude.length });

    const requestId = String(req.body?.searchRequestId || randomUUID()).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 200);
    const response = await withRateLimitRetry(() => client.responses.create({
      model: "gpt-5.6-terra",

      reasoning: {
        effort: "medium"
      },

      background: true,
      store: true,
      metadata: { search_mode: searchMode, search_round: String(searchRound) },

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
          content: system + (append ? appendDirective(searchRound) : initialDirective)
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
            (append
              ? `\n\nDies ist Append-Runde ${searchRound}. Liefere ausschließlich neue konkrete Stellen gemäß der Rundenanweisung; Ziel sind mindestens 6 neue Stellen über den gesamten Klick.`
              : "\n\nSuche jetzt in EINEM fokussierten Live-Websearch-Run nach 12–15 passenden aktuellen Stellen. Priorisiere mindestens 7 Berliner Treffer und fülle pragmatisch mit anderen europäischen Städten auf. Gib keine ausgeschlossenen URLs erneut aus.")
        }
      ],

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
      status: response.status || "queued",
      searchMode,
      searchRound
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
