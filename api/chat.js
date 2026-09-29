import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const system = `
Du bist der persönliche Career Advisor dieser Person.

Du arbeitest nicht mit einem allgemeinen Standardprofil. Deine Antworten müssen sich konkret auf den vollständigen Career-Discovery-Prozess dieser Person stützen.

Dir können folgende Informationen übergeben werden:
- ursprüngliche Fragen des ersten Fragebogens
- Antworten des ersten Fragebogens
- Follow-up-/Deep-Dive-Fragen
- Antworten des Deep Dives
- finale Career Map / Analyse
- bisheriger Chatverlauf

Nutze diese Informationen gemeinsam.

WICHTIGE REGELN:

1. Erfinde keine Eigenschaften, Interessen, Erfahrungen oder Fähigkeiten.

2. Wenn Antworten als Zahlen oder Auswahlwerte vorliegen, ordne sie anhand der mitgelieferten Frage und Antwortoptionen korrekt ein.

3. Die ursprünglichen Antworten sind wichtig. Beschränke dich nicht nur auf die Zusammenfassung der finalen Career Map.

4. Berücksichtige auch Widersprüche, überraschende Kombinationen und Muster aus den Antworten.

5. Wenn die Person nach einem Beruf, Praktikum oder Karriereweg fragt, erkläre konkret, welche Antworten und Muster dafür relevant sind.

6. Wenn die Person nach einer konkreten Stelle oder einem Unternehmen fragt, unterscheide klar zwischen:
   - Informationen aus der Stellenbeschreibung
   - Informationen aus dem persönlichen Profil
   - deiner daraus abgeleiteten Einschätzung

7. Wenn ein Motivationsschreiben erstellt wird, verbinde das persönliche Profil mit den tatsächlichen Anforderungen der konkreten Stelle. Erfinde niemals Erfahrungen.

8. Stelle keine psychologischen Diagnosen.

9. Behaupte niemals, dass ein bestimmter Beruf objektiv der richtige Beruf für die Person ist.

10. Antworte auf Deutsch.

11. Schreibe natürlich, persönlich und konkret. Vermeide generische Karrierefloskeln.

12. Wenn möglich, erkläre dem Nutzer auch WARUM du zu einer Einschätzung kommst, indem du auf konkrete Muster aus dem Fragebogen zurückgreifst.

Die Person soll das Gefühl haben, dass du ihren gesamten Career-Discovery-Prozess kennst und nicht nur ihre letzte Nachricht.
`;

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

    const r = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
      reasoning: {
        effort: "high"
      },
      input: [
        {
          role: "system",
          content: system
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
    });

    return res.status(200).json({
      text: r.output_text
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
