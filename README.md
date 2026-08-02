# test-server-cap

An [SAP CAP](https://cap.cloud.sap/docs/) implementation of the odata2ts **"Library"** OData V4
server feature test model - a deliberately feature-dense model used to evaluate which OData spec
features a given server implementation actually supports.

TypeScript / Node.js, SQLite only. No Java, no HANA, no cloud services.

## Why this exists

The reference model lives in its own repository,
[odata2ts/test-reference-model](https://github.com/odata2ts/test-reference-model):

- [`model/library.md`](https://github.com/odata2ts/test-reference-model/blob/main/model/library.md) - concept, design decisions, feature → location mapping
- [`model/library.xml`](https://github.com/odata2ts/test-reference-model/blob/main/model/library.xml) - the reference EDMX (OData **4.01**, 100 % CSDL-conformant)

That model is a deliberately feature-dense probe of the OData spec, not a benchmark. An OData server
does not have to implement all of OData, and a framework may well solve a modelling problem its own
way. So this repo asks two questions, not one:

1. How much of the model can CAP express?
2. Where CAP does something else - **is that a gap, or a different design?**

The answer is in **[FEATURE-COVERAGE.md](FEATURE-COVERAGE.md)**, the actual deliverable. It is based
on the compiled `$metadata` and on requests against the running service, not on documentation.

Short version: the protocol and operation surface is reproduced essentially completely - all 29
operations, `$batch`, deep insert, ETags, streams, `$apply`. Most structural divergence is by
design: CAP replaces inheritance with **aspects/mixins** (`abstract entity` is deprecated in CDS),
containment with **compositions**, and enum types with **value constraints**. The genuine gaps are
narrower and cluster around spatial types, flags enums, operation overloads, alternate-key
addressing, and a few places where the metadata under- or misstates actual runtime behaviour.

The same service also answers **OData V2**, through the
[`@cap-js-community/odata-v2-adapter`](https://github.com/cap-js-community/odata-v2-adapter) plugin -
one CAP service, two protocol faces. What that translation does to the model is a question of its own
and has a document of its own: **[FEATURE-COVERAGE-V2.md](FEATURE-COVERAGE-V2.md)**. Short version:
reading is solid and the V2 metadata even describes media entities and ETags _better_ than the V4 one,
while writing a single property reports success and destroys the value.

## Deliberately kept failing

Where a request fails because of a CAP limitation, it is **kept**, so the failure stays visible.
`test/requests.http` has a dedicated section for these, cross-referenced to
`FEATURE-COVERAGE.md`. Examples:

- `GET /Books(ISBN='…')` → 400 - `@Core.AlternateKeys` is in the metadata but the runtime ignores it
- `GET /Members(1)?$select=Address/City` → 400 - structured elements are flattened by default
- `GET /Branches?$filter=Amenities has 2` → 400 - no flags enum, so no `has` operator
- `Branch.Location` is declared `Edm.GeographyPoint` but delivers a WKT string

## Getting started

### As a container

The published image is the intended way to consume this server - no Node.js, no CAP tooling, no
database setup:

```bash
docker run --rm -p 4004:4004 ghcr.io/odata2ts/test-server-cap:latest
```

The seed data is baked into the image, so every container starts from the identical, well-known state.
That is what makes it usable from an automated test suite: see
[odata2ts](https://github.com/odata2ts/odata2ts/tree/main/int-test/cap), which starts and stops it per
test run via testcontainers.

`latest` is republished from every push to `main`, and a version tag additionally yields `1.2.3`,
`1.2` and `1`. The image is smoke-tested before it is pushed - including one custom operation, since
those come from the TypeScript handlers and are the part most likely to break.

### Locally

Requires Node.js ≥ 22. `@sap/cds-dk` comes in as a dev dependency (developed against 10.0.6).

```bash
npm install
npm run deploy   # creates db.sqlite and loads db/data/*.csv
npm start        # cds watch, serves on http://localhost:4004
```

> **Serve it with `cds serve`, not `cds-serve`.** The `cds-serve` binary of `@sap/cds` brings up the
> generic CRUD surface but does not load the TypeScript service implementation, so every custom
> operation answers `501 … has no handler` - and registering `tsx` as a loader does not change that.
> Use `cds serve` from `@sap/cds-dk`, which is what `npm start` and the image both do.

Service root: <http://localhost:4004/odata/v4/library/> ·
metadata: <http://localhost:4004/odata/v4/library/$metadata>

The V2 adapter mirrors that path with the version segment swapped, from its own defaults - nothing here
configures it: <http://localhost:4004/odata/v2/library/> ·
metadata: <http://localhost:4004/odata/v2/library/$metadata>

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

- Bound operations **must** be declared on the service entity. `as projection on` does not carry
  `actions {}` blocks up from the db layer.
- The file dependency order is `common` ← `circulation` ← `catalog`; backlink associations are added
  via `extend` in `catalog.cds` to keep the graph acyclic.
- The media hierarchy uses **aspects**, following CAP's table-per-leaf-class approach. This is the
  framework's intended pattern, not a workaround - see §1.1 of `FEATURE-COVERAGE.md`.
- The service runs in CAP's default **flat** mode. Setting `CDS_ODATA_STRUCTS=true` switches the
  metadata to real complex types and enables `$select`/`$filter` into them, but the JSON payload
  stays flat - metadata and payload then disagree. §2.1 documents the trade-off.

## Conventions

Aligned with the other odata2ts repositories: Prettier (`printWidth` 120, sorted imports),
EditorConfig (LF, UTF-8, 2 spaces), Conventional Commits with squash-merged PRs whose **title** is
itself a valid commit message, MIT licensed.

Deviation: this repo uses **npm** rather than Yarn 4 - the cds tooling scaffolds and tests against
npm, and this is a standalone server, not part of a workspace.
