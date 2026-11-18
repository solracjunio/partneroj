import { Controller, Get, Header } from "@nestjs/common";

import {
  openApiDocument,
  type OpenApiDocument,
  SCALAR_INTEGRITY,
  SCALAR_URL,
} from "./openapi.js";

/**
 * The page Scalar draws. The document's address is relative, so the page
 * at /api/docs (behind Caddy) reads /api/openapi.json, and the one at
 * /docs (the API alone) reads /openapi.json.
 */
const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Partneroj API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR_URL}" integrity="${SCALAR_INTEGRITY}" crossorigin="anonymous"></script>
    <script>
      Scalar.createApiReference("#app", { url: "openapi.json" });
    </script>
  </body>
</html>
`;

/**
 * The API's documentation, open to anyone: it shows what each route
 * takes and answers, never any data, and the code is public too.
 */
@Controller()
export class DocsController {
  @Get("openapi.json")
  document(): OpenApiDocument {
    return openApiDocument();
  }

  @Get("docs")
  // Express would guess text/html for a string too; said here, the page
  // doesn't depend on that guess, and the charset is stated.
  @Header("Content-Type", "text/html; charset=utf-8")
  page(): string {
    return page;
  }
}
