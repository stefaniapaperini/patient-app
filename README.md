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

## Learning FHIR: Inspector and Console

The app has Postman-like tools built in, for checking the FHIR data behind the screen and learning FHIR.

- **FHIR Inspector** (switch in the header; off whenever the page is loaded). Parts of the page that come from
  FHIR get a violet outline. **Right-click** one, or press its **ⓘ** button, to open a side panel
  titled with that element:
  1. the request the app sent, with every query parameter explained, its status and time;
  2. the resources behind the element, with the displayed fields highlighted. Hover a field name
     for an explanation; codes show their meaning (LOINC codes link to loinc.org).

  On an empty vital-sign chart, **“Why is this empty?” → Check the server** fetches all of the
  patient’s Observations without the code filter and says whether the data is missing on the server
  or the query is the problem.
- **Request log** (header button, while the inspector is on): every FHIR request made while the inspector
  is on, newest first (nothing is recorded while it's off, and switching it off empties the log),
  with the full response, **Copy as curl** and **Open in console**.
- **FHIR Console** (`/console`, linked in the header while the inspector is on): send your own GET, POST or PUT requests through the proxy, with
  parameter suggestions, an explanation of the request before you send it, paging and examples.
  The proxy rules still apply: it reads the five resource types above and only writes Patients.
- **Learn FHIR** (header button, while the inspector is on): resources, references, codes, searching, writing and errors, with
  examples that open in the console.

“Copy as curl” never contains the token: it uses `$FHIR_BASE_URL` and `$FHIR_TOKEN`. Load them with
`set -a; source .env; set +a` before running the command in a terminal.
