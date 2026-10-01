# Doro Career Discovery MVP

100 Fragen mit Rankings, Zurück-Funktion, KI-Erstanalyse, personalisiertem zweitem Fragebogen, finaler Career Map, AI Career Advisor und personalisierter Live-Jobsuche.

## Deployment

1. Repository auf Vercel importieren.
2. Die serverseitige Environment Variable `OPENAI_API_KEY` setzen.
3. Optional kann nur für die Jobsuche `OPENAI_JOBS_MODEL` gesetzt werden. Standard ist `gpt-5.6-sol`.
4. Deployen.

Lokal: `npm install`, anschließend `npx vercel dev`.

Der API-Key wird ausschließlich in den Server-Funktionen gelesen und gehört niemals ins Frontend oder Repository.

## Live-Jobsuche

Nach der Career Map startet der Nutzer die Suche bewusst im Bereich „Aktuelle Praktika / Jobsuche“. `/api/jobs` übergibt ausschließlich vorhandene Career-Map-Felder an die OpenAI Responses API und startet eine Background Response mit aktivierter Live-Websuche. Das Frontend fragt `/api/jobs-status` mit einem festen 90-Sekunden-Limit ab. Nur vollständige, normalisierte HTTP(S)-Treffer mit konkreter URL werden angezeigt; bereits bekannte und gespeicherte URLs werden bei Folgesuchen ausgeschlossen.

Die Merkliste liegt separat unter `doroSavedJobsV1` im Browser-Storage. Ein Reset des Discovery-Prozesses löscht sie daher nicht.

## Tests

```bash
npm test
```

Ein echter End-to-End-Test der Websuche benötigt `OPENAI_API_KEY`.
