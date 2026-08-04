import { readFileSync, writeFileSync } from "node:fs";

const path = "docs/openapi.yaml";
let text = readFileSync(path, "utf8");
const marker = "  /api/llm-credentials:\n";
if (text.includes(marker)) process.exit(0);
const anchor = "paths:\n";
const at = text.indexOf(anchor);
if (at < 0) throw new Error("OpenAPI paths section not found");
const block = `  /api/llm-credentials:
    get:
      summary: Read the active grounded-AI provider status
      description: Returns provider and model metadata only; API keys are never returned.
      responses:
        "200":
          description: Browser or platform provider status
          content:
            application/json:
              schema:
                type: object
                additionalProperties: false
                required: [available, source]
                properties:
                  available: { type: boolean }
                  source: { type: string, enum: [byok, platform, none] }
                  provider: { type: string, enum: [anthropic, openai] }
                  model: { type: string }
                  expiresAt: { type: string, format: date-time }
        "429": { $ref: "#/components/responses/Error" }
    post:
      summary: Connect a short-lived browser LLM credential
      description: Encrypts the supplied credential into an eight-hour HttpOnly cookie; the key is not written to the database or returned by this API.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [provider, apiKey]
              properties:
                provider: { type: string, enum: [anthropic, openai] }
                apiKey: { type: string, minLength: 10, maxLength: 512, writeOnly: true }
                model: { type: string, minLength: 1, maxLength: 120 }
      responses:
        "200": { description: Credential connected }
        "400": { $ref: "#/components/responses/Error" }
        "403": { $ref: "#/components/responses/Error" }
        "413": { $ref: "#/components/responses/Error" }
        "429": { $ref: "#/components/responses/Error" }
    delete:
      summary: Remove the browser LLM credential
      requestBody:
        required: true
        content:
          application/json:
            schema: { type: object, additionalProperties: false }
      responses:
        "200": { description: Browser credential removed }
        "400": { $ref: "#/components/responses/Error" }
        "403": { $ref: "#/components/responses/Error" }
        "429": { $ref: "#/components/responses/Error" }
  /api/editorial/node-edge-proposals/ai:
    post:
      summary: Generate a source-grounded node-edge proposal
      description: Editor-only. Compares two exact readable public node versions and creates only a proposed edge; public confirmation remains a separate human editorial decision.
      security: [{ session: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [sourceNodeId, targetNodeId]
              properties:
                sourceNodeId: { type: string, minLength: 1, maxLength: 200 }
                targetNodeId: { type: string, minLength: 1, maxLength: 200 }
                instruction: { type: string, maxLength: 2000 }
      responses:
        "200": { description: Reviewable proposal or explicit abstention }
        "400": { $ref: "#/components/responses/Error" }
        "401": { $ref: "#/components/responses/Error" }
        "403": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
        "409": { $ref: "#/components/responses/Error" }
        "413": { $ref: "#/components/responses/Error" }
        "429": { $ref: "#/components/responses/Error" }
        "502": { $ref: "#/components/responses/Error" }
  /api/inspect/ai-extract:
    post:
      summary: Extract reviewable claim and evidence candidates from an immutable inspection
      description: The inspection owner may send a bounded allowlist of exact captured text files to the selected provider. Every candidate must carry a verbatim source quote and remains separate from deterministic extraction and submission records.
      security: [{ session: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [inspectionToken]
              properties:
                inspectionToken: { type: string, minLength: 20, maxLength: 200, writeOnly: true }
                instruction: { type: string, maxLength: 2000 }
      responses:
        "200": { description: Source-grounded candidates or explicit abstention }
        "400": { $ref: "#/components/responses/Error" }
        "401": { $ref: "#/components/responses/Error" }
        "403": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
        "409": { $ref: "#/components/responses/Error" }
        "413": { $ref: "#/components/responses/Error" }
        "429": { $ref: "#/components/responses/Error" }
        "502": { $ref: "#/components/responses/Error" }
`;
text = text.slice(0, at + anchor.length) + block + text.slice(at + anchor.length);
writeFileSync(path, text);
