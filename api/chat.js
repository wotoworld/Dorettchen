import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const baseSystem = `
Du bist der persönliche Career Advisor dieser Person.

Du arbeitest mit dem vollständigen Career-Discovery-Prozess:

- ursprüngliche Fragen
- ursprüngliche Antworten
- Deep-Dive-Fragen
- Deep-Dive-Antworten
- finale Career Map / Analyse
- bisheriger Chatverlauf

WICHTIGE REGELN:

1. Erfinde keine Eigenschaften, Erfahrungen, Interessen oder Fähigkeiten.

2. Ordne Antworten anhand der mitgelieferten Fragen und Optionen korrekt ein.

3. Berücksichtige die ursprünglichen Antworten und nicht nur die Zusammenfassung.

4. Berücksichtige Widersprüche und überraschende Muster.

5. Wenn die Person nach einem Beruf, Praktikum oder Karriereweg fragt, erkläre konkret, welche Muster dafür relevant sind.

6. Wenn es um eine konkrete Stelle geht, unterscheide zwischen:
   - Stelleninformationen
   - Profilinformationen
   - deiner daraus abgeleiteten Einschätzung

7. Bei Motivationsschreiben niemals Erfahrungen erfinden.

8. Keine psychologischen Diagnosen.

9. Antworte auf Deutsch.

10. Schreibe natürlich, persönlich und konkret.

11. Wenn möglich, erkläre WARUM du zu einer Einschätzung kommst.

12. Die Person soll das Gefühl haben, dass du ihren gesamten Career-Discovery-Prozess kennst.

Wenn die Person nach AKTUELLEN Stellen, Praktika, Unternehmen mit offenen Stellen, weiteren Stellen, Jobs oder Bewerbungsmöglichkeiten fragt:

- nutze die Live-Websuche;
- suche wirklich im Internet;
- gib nur konkrete Stellen zurück, die du tatsächlich gefunden hast;
- erfinde keine Stellen oder Links;
- bevorzuge direkte Bewerbungsseiten;
- nenne bei jedem Treffer Unternehmen, Position, Ort und direkten Link;
- sage klar, wenn du keine ausreichenden aktuellen Treffer findest.
`;

function needsLiveSearch(message) {
  return /stelle|stellen|praktik|job|jobs|bewerb|offen|offene|aktuell|weitere|noch mehr|unternehmen.*suchen|suchen.*unternehmen|career|internship|junior/i.test(
    message || ""
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      message,
      profile,
      answers,
      questions,
      followup,
      history
    } = req.body || {};

    if (!message) {
      return res.status(400).json({
        error: "Missing message"
      });
    }

    const context = {
      original_questions: questions || [],
      original_answers: answers || {},
      deep_dive_questions: followup || [],
      career_profile: profile || null,
      conversation_history: history || []
    };

    const live = needsLiveSearch(message);

    const request = {
      model: process.env.OPENAI_MODEL || "gpt-5.6-sol",

      reasoning: {
        effort: "high"
      },

      input: [
        {
          role: "system",
          content: baseSystem
        },
        {
          role: "user",
          content:
            "Hier ist der vollständige Career-Discovery-Kontext:\n\n" +
            JSON.stringify(context) +
            "\n\nAktuelle Frage der Person:\n" +
            message
        }
      ]
    };

    if (live) {
      request.tools = [
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
      ];

      request.tool_choice = "required";
    }

    const r = await client.responses.create(request);

    return res.status(200).json({
      text: r.output_text
    });

  } catch (error) {
    return res.status(500).json({
      error:
        error.message ||
        "Career Advisor konnte gerade nicht antworten."
    });
  }
}
