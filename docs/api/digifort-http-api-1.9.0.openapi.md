# Digifort HTTP API 1.9.0 OpenAPI

## Source and version

The local source is [API Reference.pdf](API%20Reference.pdf), Digifort HTTP API 1.9.0 for Digifort 7.3.0, Rev. A (copyright 2002–2020). The PDF and this specification are stored together in this directory.

## Existing collection search

Before manual transcription, public sources were searched for a ready API 1.9.0 / Digifort 7.3.0 OpenAPI definition or collection:

- [GitHub repositories: Digifort API 1.9.0 collection](https://github.com/search?q=Digifort+API+1.9.0+collection&type=repositories)
- [GitHub repositories: Digifort HTTP API Postman](https://github.com/search?q=%22Digifort+HTTP+API%22+Postman&type=repositories)
- [Postman public search: Digifort API 1.9.0](https://www.postman.com/search?q=Digifort%20API%201.9.0)
- [Digifort portal Swagger UI](https://portal.digiforte.com.br/swagger/index.html), which returned Not Found for `/swagger/api/swagger.json` during the original search.

No ready specification or collection could be confirmed as matching the manual's version.

## Manual pages consulted

- Pages 2–6: table of contents.
- Pages 15–18: URL syntax, argument types, date/time formats, and filter masks.
- Pages 29–38: Basic and Safe authentication, response formats, and return-code conventions.
- Pages 41–338: API group definitions, every HTTP method/path declaration, and the operation-specific argument and response tables/examples needed to describe those operations.
- Pages 282–288: shared LPR Record Details fields, nested Tips and Middleware lists, and examples.

## Coverage

The OpenAPI file contains 136 operations, including `CreateAuthSession` (the manual labels its method `Methodo: HTTP GET`). It transcribes 430 operation-specific argument entries across 125 operations, including the manual's required markers, types, documented enum values, descriptions, and constraints. Eleven operations have no operation-specific argument table and therefore use only the common parameters documented by the manual.

Where available, the definition includes JSON response shapes/examples from 51 manual examples and typed output-field tables covering 399 fields across 67 operations. The four LPR operations that refer to the shared record-details section use a shared nested schema. Media streams, JPEG snapshots, exported files, and PCM audio upload have their documented response/request media types represented.

## Limits kept explicit

- The manual does not state a scalar type for every query argument. For those fields, the schema lists documented valid values when available and leaves the type unspecified.
- JSON examples are illustrative; OpenAPI schemas allow additional properties where the example may not list every field.
- The transcribed examples use generic account names and documentation-only IP addresses. The vendor PDF remains the source for the original examples.
- Some manual blocks provide only a default-response note or a table of text/XML parameter names without a complete JSON nesting/casing description. Those responses are marked as incomplete, and the typed canonical table fields remain in `x-digifort-output-fields`.
- The LPR `Coordinates_Left` table labels the field `String`, while the JSON example shows a number. Its schema accepts either and documents the discrepancy.
- The manual provides the audio upload format (mono PCM, 8 kHz, 16 bits/sample) but does not describe an audio upload response body beyond the default API response.

## OpenAPI validator

Validated the final JSON by posting it to [Swagger Validator](https://validator.swagger.io/validator/debug). The response contained `"schemaValidationMessages": []`; validation passed with no schema errors. This validation was run after the files were moved into `api/`.
