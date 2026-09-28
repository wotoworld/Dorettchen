# Doro Career Discovery MVP

100 Fragen mit Rankings, Zurück-Funktion, KI-Erstanalyse, personalisiertem zweitem Fragebogen, finaler Career Map und AI Career Advisor.

## Deployment
1. GitHub-Repository erstellen und diese Dateien hochladen.
2. Auf Vercel importieren.
3. Environment Variable `OPENAI_API_KEY` setzen.
4. Optional `OPENAI_MODEL=gpt-5.6-luna`.
5. Deploy.

Lokal: `npm install`, dann `npx vercel dev`.

Der API-Key gehört ausschließlich auf den Server und nie in `public/index.html`.

## Noch nicht enthalten
Accounts/Datenbank, aktuelle Praktikumsrecherche, PDF-Export und produktionsreife Datenschutz-/Einwilligungslogik. Für die Doro-Testversion ist der Fortschritt lokal im Browser gespeichert.
