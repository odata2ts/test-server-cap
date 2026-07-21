# test-server-cap

An [SAP CAP](https://cap.cloud.sap/docs/) implementation of the odata2ts **"Library"** OData V4
server feature test model - a deliberately feature-dense model used to evaluate which OData spec
features a given server implementation actually supports.

TypeScript / Node.js, SQLite only. No Java, no HANA, no cloud services.

## Why this exists

The reference model lives outside this repo, alongside it in the odata2ts workspace:

- `odata-test-data-model-library.md` - concept, design decisions, feature → location mapping
- `odata-test-data-model-library.xml` - the reference EDMX (OData **4.01**, 100 % CSDL-conformant)
- `odata-test-data-model-quirks.xml` - a separate, deliberately non-conformant fixture (not
  implemented here, see below)

This repo answers one question: **how much of that model can CAP express, and where does it break?**

The answer is in **[FEATURE-COVERAGE.md](FEATURE-COVERAGE.md)** - the actual deliverable. It is based
on the compiled `$metadata` and on requests against the running service, not on documentation.

Short version: the runtime surface is reproduced almost completely (all 29 operations work, as do
streams, `$batch`, deep insert, ETags and `$apply`), while a large part of the type system is not -
CAP has no EDM inheritance, no `<EnumType>`, no `<ComplexType>` for singular structured elements, no
containment, and only one schema per service.

## Deliberately broken

Where an operation fails because of a CAP limitation rather than a coding mistake, it is **kept**, so
the failure stays visible. `test/requests.http` has a dedicated section for these, and each is
cross-referenced to a gap ID in `FEATURE-COVERAGE.md`. Examples:

- `GET /Books(ISBN='…')` → 400 - `@Core.AlternateKeys` is in the metadata but the runtime ignores it
- `GET /Members(1)?$select=Address/City` → 400 - complex types are flattened away
- `GET /Branches?$filter=Amenities has 2` → 400 - no flags enum without `<EnumType>`
- `Branch.Location` is declared `Edm.GeographyPoint` but delivers a WKT string

## Getting started

Requires Node.js ≥ 22 and `@sap/cds-dk` (developed against 10.0.5).

```bash
npm install
npm run deploy   # creates db.sqlite and loads db/data/*.csv
npm start        # cds watch, serves on http://localhost:4004
```

Service root: <http://localhost:4004/odata/v4/library/> ·
metadata: <http://localhost:4004/odata/v4/library/$metadata>

Re-run `npm run deploy` after changing the model or the seed data to reset the database.

Other scripts: `npm run metadata` (write the EDMX to `gen/edmx/` for diffing against the reference),
`npm run typecheck`, `npm run format`.

## Layout

| Path                      | Contents                                                                         |
| ------------------------- | -------------------------------------------------------------------------------- |
| `db/common.cds`           | Shared types of `Library.Catalog`: `ISBN`, `Address`/`PostalAddress`, the enums  |
| `db/catalog.cds`          | The media hierarchy - as CDS aspects, since CAP has no EDM inheritance           |
| `db/circulation.cds`      | `Member`, `Copy`, `Loan`, `Branch`, `Bookmobile` and the operation payload types |
| `db/publishers.cds`       | The `PublisherRegistry` namespace                                                |
| `db/data/*.csv`           | Seed data with fixed keys, referenced from `test/requests.http`                  |
| `srv/library-service.cds` | Entity sets, singleton, annotations, and **all** operations                      |
| `srv/library-service.ts`  | Service implementation, wires up the handler modules                             |
| `srv/handlers/*.ts`       | Operation implementations, split into catalog / circulation / admin              |
| `test/requests.http`      | Every scenario, each annotated with the result actually observed                 |

Notes worth knowing before editing:

- Bound operations **must** be declared on the service entity. `as projection on` silently drops
  `actions {}` blocks declared in the db layer.
- The file dependency order is `common` ← `circulation` ← `catalog`; backlink associations are added
  via `extend` in `catalog.cds` to keep the graph acyclic.

## Conventions

Aligned with the other odata2ts repositories: Prettier (`printWidth` 120, sorted imports),
EditorConfig (LF, UTF-8, 2 spaces), Conventional Commits with squash-merged PRs whose **title** is
itself a valid commit message, MIT licensed.

Deviation: this repo uses **npm** rather than Yarn 4 - the cds tooling scaffolds and tests against
npm, and this is a standalone server, not part of a workspace.

## Not implemented

The quirks fixture (`odata-test-data-model-quirks.xml`: property names with spaces or slashes, an
`EnumType` with no members) is out of scope. Those constructs are intentionally CSDL-invalid; the CDS
compiler will not emit them, and forcing them through would require post-processing the generated
EDMX - which would tell us nothing about CAP.
