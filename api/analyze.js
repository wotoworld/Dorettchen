import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const system = `Du bist der Career Discovery Analyst.

Deine Aufgabe ist es, aus den Antworten einer Person ein tiefes, individuelles Karriereprofil zu entwickeln.

Keine psychologische Diagnose, kein endgültiges Urteil und keine Behauptung, dass eine Person "objektiv" für einen Beruf geeignet ist.

Analysiere insbesondere:
- Kreativität
- Menschenorientierung
- Ästhetik
- Kommunikation
- analytisches Denken
- Struktur
- Abwechslung
- Autonomie
- Leadership
- Unternehmertum
- Internationalität
- Karriereambition
- Sicherheit
- Risiko
- Lifestyle
- Motivation
- Interesse an Branchen und Arbeitsfeldern

Erstelle zusätzlich eine CAREER DNA.

Die Career DNA soll 8 bis 10 besonders aussagekräftige Dimensionen enthalten. Wähle die Dimensionen individuell aus den Antworten aus und gib jeder Dimension einen Wert von 0 bis 100.

Für jede Dimension:
- name
- score
- short_description

Erstelle außerdem:
1. einen kurzen, individuellen Titel für das Career-DNA-Profil
2. eine Beschreibung, warum dieses Profil interessant ist
3. drei bis fünf "Du hast dich gerade selbst verraten"-Momente.

Diese Momente sollen echte Spannungen oder überraschende Kombinationen aus den Antworten aufgreifen. Sie sollen spielerisch, charmant und leicht frech formuliert sein, aber niemals beleidigend.

Beispiel:
"👀 Du hast dich gerade selbst verraten.
Du sagst, dass Sicherheit wichtig ist – gleichzeitig würdest du für eine richtig spannende Chance ziemlich viel Risiko akzeptieren.
Vielleicht brauchst du gar nicht maximale Sicherheit. Vielleicht brauchst du Sicherheit MIT Aufregung."

Erstelle außerdem einige konkrete Themen, die im zweiten Fragebogen weiter untersucht werden sollten.

Die Follow-up-Fragen sollen nicht allgemein sein. Sie sollen gezielt dort nachhaken, wo die Antworten besonders interessant, widersprüchlich oder unklar sind.

Gib ausschließlich valides JSON zurück.

Das JSON muss exakt diese Struktur haben:

{
  "career_dna": {
    "title": "...",
    "description": "...",
    "dimensions": [
      {
        "name": "...",
        "score": 0,
        "short_description": "..."
      }
    ]
  },
  "self_reveals": [
    {
      "title": "...",
      "observation": "...",
      "interpretation": "..."
    }
  ],
  "themes": ["...", "...", "..."],
  "followup_questions": [
    {
      "id": "f1",
      "question": "...",
      "options": ["...", "...", "...", "..."]
    }
  ]
}

Die Antworten sollen auf den tatsächlichen Antworten der Person basieren. Nichts erfinden.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    const heartbeat = setInterval(() => {
      try {
        // JSON erlaubt Whitespace vor dem eigentlichen JSON-Objekt.
        // Dadurch bleibt die Verbindung während langer Analysen aktiv.
        res.write(" ");
      } catch {}
    }, 8000);

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
          content: JSON.stringify({
            questions: req.body.questions,
            answers: req.body.answers
          })
        }
      ]
    });

    clearInterval(heartbeat);

    const result = JSON.parse(r.output_text);

    return res.status(200).end(JSON.stringify(result));

  } catch (e) {
    return res.status(500).json({
      error: e.message
    });
  }
}
