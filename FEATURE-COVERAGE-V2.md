# The V2 adapter and the "Library" test model

How much of this server survives the trip through
[`@cap-js-community/odata-v2-adapter`](https://github.com/cap-js-community/odata-v2-adapter) — and where the
OData **V2** face of the service says something different from the V4 one underneath it.

Measured against **@cap-js-community/odata-v2-adapter 1.16.0** on **@sap/cds 10.0.3**, same model, same
seed data, same process as [FEATURE-COVERAGE.md](FEATURE-COVERAGE.md). Every statement below was verified
against the emitted V2 `$metadata` and against the running service.

> **FEATURE-COVERAGE.md stays the document.** It covers this server and the reference model. This one covers
> **only** what the V2 adapter adds, removes or changes on top of it. Where V2 behaves like V4, it is not
> repeated here.

Service root: <http://localhost:4004/odata/v2/library> ·
metadata: <http://localhost:4004/odata/v2/library/$metadata>

The path mirrors the V4 one — only the version segment differs — and comes from the adapter's defaults
(`cds.env.cov2ap.path` = `odata/v2`, `targetPath` = `odata/v4`); nothing in this repo configures it.

## How to read this document

**There is no V2 service here.** There is one CAP service, `Library.Service`, serving OData V4 at
`/odata/v4/library`. The adapter registers itself as an Express middleware during `bootstrap`, accepts V2
requests at `/odata/v2/library`, rewrites them into V4 requests against that same endpoint, and rewrites the
answers back. The server log shows it plainly:

```
[cov2ap/hpm] - [HPM] GET /odata/v2/library/Books -> http://localhost:4004/odata/v4/library/Books [200]
```

Three consequences run through everything below:

1. **The V2 metadata is a translation, not a second model.** Anything V2 cannot express is substituted,
   dropped, or re-expressed — §1.
2. **Whatever the adapter does not translate, it forwards.** So a request that is _not_ valid V2 may work
   anyway, because a V4 service answers it — §3.4. That is convenient and misleading in equal measure: it
   is not the V2 protocol answering.
3. **Where the translation is lossy, it is lossy silently.** The sharpest case is §3.3: a write that reports
   success and deletes the value it was meant to set.

The findings are backed by the integration tests in
[odata2ts/int-test/cap/test/v2](https://github.com/odata2ts/odata2ts/tree/main/int-test/cap/test/v2), which
run the generated odata2ts V2 client against this server. Where a section names a test, that is where the
behaviour is pinned.

---

## 1. What the translated metadata looks like

The document is EDMX 1.0 with `m:DataServiceVersion="2.0"`. The schema namespace is unchanged
(`Library.Service`), and so are the entity type names, the property names and the flattening of structured
elements (§2.1 of FEATURE-COVERAGE.md) — the adapter inherits all of that.

### 1.1 Faithfully carried over

| Feature                                   | Note                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Entity types, keys, composite keys        | including `Copies(MediumId=…,InventoryNumber=…)`                                                 |
| Complex types                             | all 8, incl. as collection-valued properties and in operation payloads                           |
| Navigation                                | as `<Association>` + `<AssociationSet>`, 15 of them                                              |
| Referential constraints                   | all of them; a compound one becomes a single element with two `PropertyRef`s, where V4 emits two |
| `Validation.AllowedValues` (the enums)    | all 3 annotations pass through unchanged                                                         |
| Foreign-key properties next to navigation | `Publisher_Id`, `Location_Id`, … — as in V4                                                      |
| Operations                                | all 29, see §1.3                                                                                 |

### 1.2 Substituted, because V2 has no such type

| V4                     | V2                                    | Effect                                                                |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `Edm.Date`             | `Edm.DateTime` + `sap:display-format` | a date becomes a timestamp with a hint attached                       |
| `Edm.TimeOfDay`        | `Edm.Time`                            | serialised as a duration since midnight: `PT09H00M00S`                |
| `Edm.Duration`         | `Edm.String`                          | the value is unchanged (`PT1H`), the type information is gone         |
| `Singleton MainBranch` | `EntitySet MainBranch`                | V2 has no singletons — and the runtime does not follow this, see §3.5 |
| `Edm.Stream` property  | `m:HasStream="true"` on the entity    | a stream property becomes a media link entry, see §2.1                |

### 1.3 Operations, flattened

V2 knows neither bound operations nor the `Namespace.Name(...)` call syntax. Every operation becomes a
`FunctionImport` on the entity container:

- an unbound one keeps its name — `Search?Term='Prozess'&MaxResults=1`
- a bound one is renamed `<EntitySet>_<Operation>` and takes the key of its receiver as an ordinary
  parameter — `Books_LoanMetrics?Id=guid'…'`, marked `sap:action-for="Library.Service.Books"`
- an action is a `FunctionImport` with `m:HttpMethod="POST"`; nothing else distinguishes it from a function

All 29 operations are present and all return-type variants work — see
[`test/v2/core/Operations.test.ts`](https://github.com/odata2ts/odata2ts/blob/main/int-test/cap/test/v2/core/Operations.test.ts).
Two cannot be called at all through the translated signature:

| Operation                  | Result                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AvailableLanguages`       | 400 — bound to `many $self` in CDS, flattened to a **single**-key import; the call the metadata allows is the one the V4 service then refuses. V2 has no notation for the intended call |
| `LoanStatistics(Period=…)` | 400 `Invalid value: Period` — V2 function imports take primitive parameters only                                                                                                        |

### 1.4 Lost in translation

| Feature                    | What happens                                                |
| -------------------------- | ----------------------------------------------------------- |
| `OpenType="true"`          | dropped — `CollectorsItems` looks closed in V2              |
| `Edm.Stream` as a property | no property remains — the content moves to the entity, §2.1 |

### 1.5 Added, and not in the V4 document

`Copy.Condition` comes out as `ConcurrencyMode="Fixed"`. The behaviour is not new — `@odata.etag` makes
every write against a copy answer 428 without `If-Match`, over V4 exactly as much — but the **declaration**
is. The V4 document emits an empty `Core.OptimisticConcurrency` annotation that names no property
(FEATURE-COVERAGE.md §4.2); the V2 one names it. For a client generating code from metadata, that is the
difference between being able to implement optimistic concurrency and not.

### 1.6 Not actually V2

`Keywords` is emitted as `Type="Collection(Edm.String)"`. Collection-valued primitive properties do not
exist in OData V2 — they arrived in V3. A strict V2 consumer has no way to read that declaration, and the
runtime behaviour around it is broken in its own right (§3.3).

---

## 2. Binary content — better than V4 here

### 2.1 Media link entries instead of stream properties

This is the one place where the V2 face of the service is **closer to the reference model** than the V4 one.

CAP emits no `HasStream` and models binary content as `Edm.Stream` properties (FEATURE-COVERAGE.md §2.4).
V2 has no `Edm.Stream` at all, so the adapter falls back to what V2 does have — the media link entry — and
`Audiobooks`, `AudiobookChapters` and `EBooks` come out as `m:HasStream="true"`. The reference model
declares `EBook` a media entity, so the translated document is the more faithful of the two.

| Address                                    | Result                                            |
| ------------------------------------------ | ------------------------------------------------- |
| `EBooks(guid'…')/$value`                   | 200, the bytes, with the MIME type from the model |
| `EBooks(guid'…')` → `__metadata.media_src` | the `$value` URL, advertised on every entity      |
| `Audiobooks(guid'…')/Sample`               | 200 — the V4 address still answers, see §3.4      |

The price is V2's own limit: the content belongs to the _entity_, so an entity can carry exactly one binary
payload. A model with two named streams on one type could not be expressed.

Pinned in
[`test/v2/feature/Blobs.test.ts`](https://github.com/odata2ts/odata2ts/blob/main/int-test/cap/test/v2/feature/Blobs.test.ts).

---

## 3. Protocol

### 3.1 The envelope

Everything sits in `d`; a collection additionally in `d.results`. Every entity carries `__metadata`
(`uri`, `type`, and `etag`/`media_src` where they apply), and an unexpanded navigation property is a
`__deferred` link rather than being omitted.

Counting is `$inlinecount=allpages`, and the count comes back as a **string** in `d.__count`.

### 3.2 What works as V2 prescribes

| Scenario                                                          | Result                                            |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| `$filter`, `$orderby`, `$top`, `$skip`, `$select`, `$inlinecount` | 200                                               |
| V2 filter literals: `guid'…'`, `datetime'…'`, `substringof(…)`    | 200                                               |
| `$expand`, and deep select via `$select=Publisher/Name`           | 200                                               |
| `MERGE` tunnelled as `POST` + `X-Http-Method: MERGE`              | 200                                               |
| Create, read, delete                                              | 201 / 200 / 204                                   |
| Navigation as a sub-resource (`Books(…)/Copies`)                  | 200                                               |
| Deep insert                                                       | as over V4 — compositions only, §3.6              |
| `$batch`, multipart                                               | 200                                               |
| Errors                                                            | `{"error":{"message":{"lang","value"},"code",…}}` |

Not supported, correctly so or otherwise:

| Scenario             | Result                                                |
| -------------------- | ----------------------------------------------------- |
| `$format=xml` (Atom) | 501 — JSON only                                       |
| Server-driven paging | no `__next`, no `$skiptoken`                          |
| `$links`             | 200, but the response is the full entities, not links |

### 3.3 Writing a single property destroys it

**The most damaging finding in this document.** A `PUT` against a property URL is answered **204** and
leaves the property `null` — or, for a collection-valued one, empty. The value sent never arrives.

```
GET /Books(guid'…')/Language          -> 200 {"d":{"Language":"de"}}
PUT /Books(guid'…')/Language  {"Language":"en"}   -> 204
GET /Books(guid'…')/Language          -> 204   # not "en", and not "de" either
GET /Books(guid'…')                   -> "Language": null
```

Every payload shape V2 allows was tried, so this is not a client picking the wrong one:

| Request                                              | Result                    |
| ---------------------------------------------------- | ------------------------- |
| `PUT …/Language` with `{"Language":"en"}`            | 204, value nulled         |
| `PUT …/Language` with `{"d":{"Language":"en"}}`      | 204, value nulled         |
| `PUT …/Language/$value` with `text/plain`            | 415                       |
| `PUT …/Keywords` with `{"d":{"Keywords":["A","B"]}}` | 204, collection emptied   |
| `POST …/Keywords` (append)                           | 400, **empty error body** |
| `MERGE` on the entity with `{"Language":"en"}`       | 200, value set ✔          |

The V4 endpoint of the same server honours all of these (FEATURE-COVERAGE.md, property resources), so the
loss is introduced by the adapter. What makes it worse than an outright rejection is the status: a client
gets a success for a write that deleted data, and only a read-back reveals it.

Reading a collection-valued property is broken in a second, milder way: `GET …/Keywords` answers in the
_value_ shape (`{"d":{"Keywords":[…]}}`) rather than the collection shape (`{"d":{"results":[…]}}`) its own
metadata implies.

Pinned in
[`test/v2/feature/PropertyServices.test.ts`](https://github.com/odata2ts/odata2ts/blob/main/int-test/cap/test/v2/feature/PropertyServices.test.ts).

### 3.4 What is forwarded rather than translated

Anything the adapter does not recognise is passed to the V4 endpoint unchanged. So requests that are not
valid OData V2 succeed — because a V4 service is answering them:

| Request                                      | Result                                                 |
| -------------------------------------------- | ------------------------------------------------------ |
| `$filter=Copies/any(a:a/IsLoanable eq true)` | 200, correctly filtered — lambdas do not exist in V2   |
| `$search=Prozess`                            | 200                                                    |
| `/Books/$count`                              | 200, `text/plain`                                      |
| `Audiobooks(guid'…')/Sample`                 | 200 — a property that is not in the V2 metadata at all |

Useful in practice, and a trap for anything that treats this endpoint as a V2 conformance reference: none
of these would work against a real V2 server, and none of them can be reached from a client generated off
the V2 metadata, since the metadata does not describe them.

The forwarding also passes CAP's failure modes through untouched: `$filter=Keywords/all(a:a ne 'X')` still
takes the **whole process** down (FEATURE-COVERAGE.md, lambda over a primitive collection). V2 is simply
another way to reach the same crash.

### 3.5 Where the runtime contradicts the translated metadata

| Declared                                     | Actual                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MainBranch` is an `EntitySet`               | `GET /MainBranch` answers with a **single entity**, no `results` array. `GET /MainBranch(1)` works as declared — so the set is addressable, it just does not behave like one without a key                    |
| `update`/`merge` answer 204 with no content  | 200 with the full entity — the V4 representation is handed through                                                                                                                                            |
| `__metadata.type` on a complex value         | mangled: `Library_Circulation_BranchStats` arrives as `Library.Service.ion_BranchStats`, `Library_Catalog_MediumStats` as `Library.Service.MediumStats`. Anything dispatching on the declared type name fails |
| A primitive operation result is `d.<OpName>` | holds for `Edm.Int32` and `Edm.Decimal`; an `Edm.Int64` result arrives wrapped once more: `{"d":{"TotalMediaCount":{"value":"19","__metadata":{}}}}`                                                          |

None of these is announced anywhere. Each was found by comparing a response against the metadata that
described it.

### 3.6 Deep insert — unchanged

The rule is CAP's and the adapter does not touch it: deep operations run along **compositions**, never
along associations. All four cases behave exactly as over V4 (FEATURE-COVERAGE.md §1.2):

| Relationship                                | Result                                    |
| ------------------------------------------- | ----------------------------------------- |
| to-one composition (`Members/IdDocument`)   | 201, child created                        |
| to-many composition (`Audiobooks/Chapters`) | 201, children created and linked          |
| to-one association, key only                | 201, foreign key filled in                |
| to-one association, any other property      | 400 `Property "Name" does not exist in …` |
| to-many association (`Books/Copies`)        | 201, payload silently dropped             |

One V2 improvement: the create response **inlines** the nested entity that was created, so the client sees
the generated keys without a re-read.

---

## 4. Data types on the wire

V2's JSON format serialises the numeric types that do not fit a JavaScript number as strings, and timestamps
as ticks. All of it is correct here:

| Type                                       | On the wire                               | Note                      |
| ------------------------------------------ | ----------------------------------------- | ------------------------- |
| `Edm.Int64`, `Decimal`, `Double`, `Single` | `"1841000"`, `"0.00"`, `"87.5"`, `"0.31"` | string, as V2 prescribes  |
| `Edm.Int16`, `Int32`                       | `224`                                     | number                    |
| `Edm.Byte`, `SByte`                        | `16`, `-2`                                | number                    |
| `Edm.DateTime` (was `Edm.Date`)            | `/Date(-1410134400000)/`                  | ticks since the epoch     |
| `Edm.DateTimeOffset`                       | `/Date(1554110100000+0000)/`              | offset appended           |
| `Edm.Time` (was `Edm.TimeOfDay`)           | `PT09H00M00S`                             | a duration since midnight |
| `Edm.Guid`                                 | bare in the payload, `guid'…'` in the URL |                           |
| Geography / Geometry                       | WKT strings                               | as over V4                |

Both date notations are accepted in a filter — the canonical `datetime'1925-04-26T00:00:00'` and the
round-tripped `datetime'/Date(-1410134400000)/'`, which is what a client that filters on a value it just
read produces.

Pinned in
[`test/v2/feature/DataTypes.test.ts`](https://github.com/odata2ts/odata2ts/blob/main/int-test/cap/test/v2/feature/DataTypes.test.ts).

---

## 5. Overview

**Faithful** answers "does the V2 face agree with the V4 service behind it?" — ✅ yes, ⚠️ with a caveat,
❌ no. Everything not listed behaves as FEATURE-COVERAGE.md describes.

### Metadata

| Feature                               | Faithful | Note                                                               |
| ------------------------------------- | -------- | ------------------------------------------------------------------ |
| Entity types, keys, complex types     | ✅       |                                                                    |
| Navigation, referential constraints   | ✅       | as associations and association sets (§1.1)                        |
| Enum annotations                      | ✅       | `Validation.AllowedValues` passes through                          |
| Operations, all 29                    | ⚠️       | flattened to imports; 2 unreachable through the translation (§1.3) |
| `Edm.Date` / `TimeOfDay` / `Duration` | ⚠️       | substituted; values intact, type information lost (§1.2)           |
| Media entities                        | ✅       | **better than V4** — real `HasStream` (§2.1)                       |
| ETag declaration                      | ✅       | **better than V4** — names the property (§1.5)                     |
| Singleton                             | ❌       | becomes an entity set, and the runtime disagrees (§3.5)            |
| Open types                            | ❌       | dropped (§1.4)                                                     |
| `Collection(Edm.String)` property     | ❌       | emitted although V2 has no such thing (§1.6)                       |

### Protocol

| Feature                                             | Faithful | Note                                                     |
| --------------------------------------------------- | -------- | -------------------------------------------------------- |
| Read: `$filter`/`$orderby`/`$top`/`$skip`/`$select` | ✅       |                                                          |
| `$inlinecount`, V2 filter literals                  | ✅       |                                                          |
| `$expand` and deep select                           | ✅       | no nested options, as V2 prescribes                      |
| Create, read, delete, MERGE                         | ✅       |                                                          |
| Deep insert                                         | ✅       | identical rules, children inlined in the response (§3.6) |
| `$batch` multipart                                  | ✅       |                                                          |
| Write response body                                 | ⚠️       | 200 + representation where V2 says 204 (§3.5)            |
| Non-V2 requests                                     | ⚠️       | forwarded to V4 and answered (§3.4)                      |
| Collection-valued property, reading                 | ⚠️       | value shape instead of collection shape (§3.3)           |
| `$format=xml`, paging, `$links`                     | ❌       | 501 / absent / wrong shape (§3.2)                        |
| **Writing a single property**                       | ❌       | 204 and the value is destroyed (§3.3)                    |
| `__metadata.type` of complex values                 | ❌       | mangled type name (§3.5)                                 |
| `Edm.Int64` operation result                        | ❌       | double-wrapped (§3.5)                                    |

---

## Conclusion

For **reading**, the adapter is good. The envelope, the type serialisation, the filter literals, `$expand`,
`$inlinecount` and the operation surface are all there and all correct, and in two places — media entities
and the ETag declaration — the V2 metadata describes this service **better** than its own V4 document does.
A read-only V2 client over this model is a realistic proposition.

For **writing**, it is not, and the reason is not a missing feature but a wrong answer: a `PUT` against a
property URL reports 204 and deletes the value. Nothing distinguishes that from success. Everything else in
§3.5 has the same shape at a smaller scale — a runtime that quietly contradicts the metadata it just served.
A client can work around all of it (write whole entities via `MERGE`, ignore `__metadata.type`, unwrap the
`Int64` twice), but only once it knows, and the metadata never tells it.

The other half of the picture is §3.4. Because unrecognised requests are forwarded to the V4 endpoint,
this server answers a good deal that no V2 server would, and it hides its own limits in the process.
That makes it a fine compatibility layer for SAP tooling and a poor yardstick for V2 conformance — the
distinction worth keeping in mind before reading any of the ✅ above as "V2 supports this".
