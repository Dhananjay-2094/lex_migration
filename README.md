# Lex Migration

Browser-based Angular tool for converting an exported AWS Lex V1 bot JSON into AWS Lex V2 import artifacts.

The app runs locally in the browser. It does not upload the Lex export to a backend service.

## What It Generates

After selecting a Lex V1 JSON export, the app creates two ZIP files:

- `<bot-name>_v2_Lex.zip`
  - Lex V2 bot import package
  - Includes `Manifest.json`, `Bot.json`, `BotLocale.json`, slot types, intents, slots, fallback intent, and fallback conversation flow
- `<bot-name>_v2_Lambda.zip`
  - Lambda router package
  - Includes `lambda_function.py`
  - Includes `lex_v2_v1_conversion.py` for translating Lex V2 events/responses to and from Lex V1-style Lambda payloads

## Features

- Converts Lex V1 bot metadata into a Lex V2-compatible folder structure.
- Converts custom slot types and slot values.
- Normalizes selected Lex V1 built-in slot type names to Lex V2-compatible names.
- Converts response-card buttons into Lex V2 image response cards.
- Preserves intent-to-Lambda routing by generating a Lambda router.
- Generates fallback intent and fallback conversation-flow artifacts.
- Supports modern browser save dialogs when available, with a download-link fallback for other browsers.

## Usage

1. Start the app.
2. Enter an optional bot description.
3. Choose a Lex V1 bot export `.json` file.
4. Click `Generate ZIP files`.
5. Save both generated ZIP files.
6. Import the Lex ZIP into AWS Lex V2.
7. Deploy the generated Lambda package as needed for migrated Lambda routing.

## Development

Install dependencies:

```bash
npm install
```

Run the local development server:

```bash
npm start
```

Open:

```text
http://localhost:4200/
```

Build the app:

```bash
npm run build
```

Run tests:

```bash
npm test
```

## Project Structure

`src/app/app.component.*`

UI layer for file upload, description input, status display, and download handling.

`src/app/lex-migration.service.ts`

Core migration orchestration. Builds the Lex V2 ZIP and Lambda ZIP from the uploaded Lex V1 export.

`src/app/lex-artifact-templates.ts`

Static/factory templates for generated fallback intent JSON, fallback conversation-flow JSON, Lambda router source, and Lex V2/V1 conversion helper source.

## Notes And Limitations

- The app expects a valid AWS Lex V1 bot export JSON with a `resource` object.
- Some Lex V1/V2 features may still require manual validation after import in AWS.
- Custom slot type names are trimmed to fit Lex V2 naming constraints.
- The generated Lambda router logs Lex events/responses for debugging; review logging before production deployment if the bot handles sensitive user data.
- The Angular build may warn that `jszip` is CommonJS. This is currently expected and does not prevent the app from building.
