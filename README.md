# Patient Management App (FHIR R4)

A Next.js app that lists, searches, creates and edits patients on a FHIR R4 server, and shows each
patient's vital signs, conditions and medications. All data is read from and written to the FHIR
server; nothing is stored locally.

## Configuration

Copy `.env.example` to `.env` and fill in both values (no quotes):

```
FHIR_BASE_URL=https://your-fhir-server/fhir/...
FHIR_TOKEN=your-bearer-token
```

The token is only read by the server-side proxy and is never sent to the browser. `.env` is
ignored by git and by Docker builds.

## Run locally (http://localhost:3000)

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev        # development
npm test           # unit tests
npm run build      # production build
```

## Run in Docker (http://localhost:8080)

```bash
docker build -t patient-app .
docker run -p 8080:8080 --env-file .env patient-app
```

## How it works

- **FHIR proxy** – `app/api/fhir/[[...path]]/route.ts`. The browser calls `/api/fhir/<path>?<query>`;
  the proxy forwards it to `${FHIR_BASE_URL}/<path>?<query>` with `Authorization: Bearer …`.
  It only allows reading Patient, Observation, Condition, MedicationRequest and Medication, and
  only two writes: `POST /Patient` and `PUT /Patient/{id}` (anything else gets 403). It rewrites
  Bundle paging links so they go back through the proxy, and turns network failures, timeouts
  and auth errors into FHIR `OperationOutcome` messages.
- **Patient list** (`/`) – loads 50 patients per page sorted by family name and loads more on scroll,
  so it works with thousands of patients. The table scrolls after 10 rows.
- **Search** – `name:contains` (matches anywhere in the name); falls back to `name` (starts-with)
  if the server does not support `:contains`. The challenge server has `:contains` disabled
  (HTTP 405, HAPI-1258), so there search matches the start of any given or family name.
- **Create / edit** – one form with validation (required names, gender, real date of birth that is
  not in the future, optional phone). Create = `POST /Patient`; edit = `PUT /Patient/{id}` with
  `If-Match`, keeping all fields the form does not edit.
- **Patient details** (`/patient/[id]`) – demographics; vital signs as charts or a table
  (blood pressure from panel components 8480-6 / 8462-4); conditions with a text filter and an
  Active / Not active / All switch; medications with dose, frequency, route and status. Medication
  names come from `medicationCodeableConcept`, or from `medicationReference` resolved through
  `_include`, contained resources, or a separate `GET /Medication/{id}`.

The vitals query also includes `85354-9` (the blood pressure panel code used by Synthea and US Core)
and standalone systolic/diastolic codes, so blood pressure shows however it is stored.
