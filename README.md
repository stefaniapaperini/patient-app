# Patient Management App (FHIR R4)

A Next.js app that lists, searches, creates and edits patients on a FHIR R4 server, and shows each
patient's vital signs, conditions and medications. All data is read from and written to the FHIR
server; nothing is stored locally.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system structure, request flows, security model,
and extension guidance.

## Configuration

Copy `.env.example` to `.env` and fill in both values (no quotes):

```
FHIR_BASE_URL=https://your-fhir-server/fhir/...
FHIR_TOKEN=your-bearer-token
```

The token is only read by the server-side proxy and is never sent to the browser. `.env` is
ignored by git and by Docker builds.

### Imaging (optional)

To show DICOM images on the patient page, also set the DICOMweb server (see `.env.example`):

```
DICOMWEB_QIDO_URL=https://dicomserver.co.uk:8989/qido
DICOMWEB_WADO_URL=https://dicomserver.co.uk:8989/wado
DICOM_DEMO_PATIENTS=fhirPatientId:MC_EXAMPLE_1,otherFhirPatientId:MC_EXAMPLE_3
```

Without `DICOMWEB_QIDO_URL` the imaging section is hidden. Servers with a single DICOMweb root
only need `DICOMWEB_QIDO_URL`. `DICOM_DEMO_PATIENTS` is optional: it links FHIR patients to example
patients on the DICOM server, to demonstrate the viewer (see "Imaging" below).

**The public server [dicomserver.co.uk](https://www.dicomserver.co.uk/) is for testing only.** The
app looks up FHIR ImagingStudy UIDs and demo patient IDs there. That is fine for synthetic data
such as Synthea's, but never point the app at a public server with real patient data.

## Run locally (http://localhost:3000)

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev        # development
npm test           # unit tests
npm run build      # production build
```

The app is only available while `npm run dev` keeps running: leave that terminal open and open
http://localhost:3000 in your browser. Closing the terminal (or pressing Ctrl+C, or restarting the
computer) stops it, and the browser then reports that it cannot connect. Run `npm run dev` again to
start it. `npm install` is only needed the first time and after dependencies change.

## Run in Docker (http://localhost:8080)

```bash
docker build -t patient-app .
docker run -p 8080:8080 --env-file .env patient-app
```

To keep it running in the background and start it again automatically after a restart, run the
container detached with a restart policy instead (Docker itself must start at boot):

```bash
docker run -d --name patient-app --restart unless-stopped -p 8080:8080 --env-file .env patient-app
```

Stop it with `docker stop patient-app`. After rebuilding the image, remove the old container with
`docker rm -f patient-app` and run the command again.

## How it works

- **FHIR proxy** – `app/api/fhir/[[...path]]/route.ts`. The browser calls `/api/fhir/<path>?<query>`;
  the proxy forwards it to `${FHIR_BASE_URL}/<path>?<query>` with `Authorization: Bearer …`.
  It only allows reading Patient, Observation, Condition, MedicationRequest, Medication and ImagingStudy, and
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

- **Imaging** (patient page, only when a DICOMweb server is configured) – lists the patient's FHIR
  `ImagingStudy` resources and looks up each StudyInstanceUID on the DICOM server (QIDO-RS).
  Studies found there can be opened in a viewer: pick a series, then step through its images
  with the slider, the mouse wheel or the arrow keys. Images are JPEGs rendered by the DICOM
  server (WADO-RS `/rendered`), with its default contrast: for viewing and learning, not for
  diagnosis. A patient linked in `DICOM_DEMO_PATIENTS` also shows the studies of that example
  DICOM patient, marked "Demo images – not this patient". The Synthea data's ImagingStudy UIDs are
  made up, so their images are not on any server: the demo links are how the viewer can be tried.
  All DICOM requests go through a read-only proxy, `app/api/dicomweb/[[...path]]/route.ts`.

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

## License

This project is released under the [MIT License](LICENSE): you may use, copy, modify and distribute
it for any purpose, as long as the copyright and license notice are kept with copies of the code. It is made for learning
FHIR and is **not a medical device**: do not use it for real clinical decisions.

Third-party components keep their own licenses. The npm dependencies are mainly MIT, ISC,
Apache-2.0 and BSD licensed; see each package in `node_modules` for its license text. The app
shows the names of a few LOINC codes (in `lib/inspector/glossary.ts`). This material contains
content from LOINC® (https://loinc.org), which is copyright © Regenstrief Institute, Inc. and the
LOINC Committee and is available at no cost under the license at https://loinc.org/license.
