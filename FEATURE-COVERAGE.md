# CAP coverage of the "Library" OData V4 test model

What SAP CAP (Node.js) can and cannot reproduce from
[`odata-test-data-model-library.xml`](../../odata-test-data-model-library.xml), the 100 % CSDL-conformant
OData **V4.01** reference model.

Measured against **@sap/cds 10.0.3** / **@sap/cds-dk 10.0.5**, Node 26, `@cap-js/sqlite` 3.
Every verdict below was verified against the compiled `$metadata` and against the running service -
none of it is inferred from documentation.

Legend: ✅ reproduced · 🔶 partially / via workaround · ❌ not reproducible

---

## Summary

CAP reproduces the **runtime surface** of the model remarkably well: all 29 operations of the
reference model exist and are callable, every return-type and parameter-type combination works,
streams, `$batch`, deep insert, ETags and `$apply` all behave.

What it cannot reproduce is a large part of the **type system**: EDM inheritance, `<EnumType>`,
`<ComplexType>` for singular structured elements, `<TypeDefinition>`, containment, and multiple
schemas. CAP's EDM is deliberately flat, and there is no annotation or config flag to change that -
the two historical escape hatches (`cds.odata.structs`, `cds.odata.containment`) are inert in cds 10.

The one outright **spec violation** found: CAP emits `Edm.Untyped` - a 4.01-only type - inside a
document declared `Version="4.0"` (G10).

---

## Gaps

### G1 - No `<ComplexType>` for singular structured elements ❌

The reference model uses complex types throughout (`Address`/`PostalAddress`, `ConditionReport`,
`MediumStats`, `OverdueNotice`, …). CAP **flattens** a structured element into individual columns:
`Member.Address` becomes `Address_Street`, `Address_City`, `Address_PostalCode`, `Address_Country`.

Consequences, all observable:

- `GET /Members(1)?$select=Address` → **400**, the property does not exist under that name
- `GET /Members(1)?$select=Address/City` → **400**, so the deep-`$select`-into-complex-type scenario
  (odata2ts#391/#393) cannot be tested against this server at all

Complex types _are_ emitted where the type appears as a **collection** or as an **operation
parameter / return type**. Six `<ComplexType>` elements exist in the generated metadata
(`Library_Catalog_PostalAddress`, `Library_Circulation_LoanStats`, `…_DateRange`, `…_BranchStats`,
`…_AnnualReport`, `…_OverdueNotice`), reachable via `Member.PreviousAddresses`, `LoanStatistics`,
`StatsPerBranch`, `YearEndClosing` and `NoticeHistory`. Note the namespace-mangled names.

`cds.odata.structs` is accepted on the command line but has **no effect** - verified with
`cds compile srv --to edmx --odata-structs=true`, which produces byte-identical output. The
capire docs mark it deprecated and "likely to be removed with the next major release"; in cds 10 it
evidently is.

### G2 - No EDM inheritance, no abstract entity types ❌

The single most consequential gap. The reference model builds a four-level chain
(`Medium` → `PrintMedium` → `Magazine` → `TradeJournal`), a second branch
(`Medium` → `AudioMedium` → `Audiobook`/`DVD`), plus `Address` → `PostalAddress` on the complex-type
side, and exposes **one** entity set `Media` over the abstract root.

CDS aspects are a _mixin_: including an aspect copies its elements. The generated metadata contains
**zero** `BaseType=` and **zero** `Abstract=` attributes.

This server therefore models the hierarchy with aspects (`Medium`, `PrintMedium`, `MagazineLike`,
`AudioMedium` in [db/catalog.cds](db/catalog.cds)) and exposes **seven** entity sets - `Books`,
`Magazines`, `TradeJournals`, `Audiobooks`, `DVDs`, `EBooks`, `CollectorsItems` - instead of one.
The element structure is faithful; the type relationships are gone.

Knock-on effects:

| Reference model feature                                      | Status here                              |
| ------------------------------------------------------------ | ---------------------------------------- |
| Entity set `Media` over the abstract base                    | ❌ seven concrete sets instead           |
| Type-cast path segments (`Media/Library.Catalog.Book`)       | ❌ nothing to cast between               |
| `@odata.type` discriminator in write payloads (odata2ts#257) | 🔶 accepted, but selects nothing         |
| `cast()` in `$filter` over the hierarchy (odata2ts#323)      | ❌ **501 Not Implemented**               |
| Operations bound to / returning `Medium`                     | 🔶 repeated per concrete type, see below |
| `Copy.Medium` association + its `<ReferentialConstraint>`    | 🔶 replaced by a plain `MediumId` Guid   |

The `Copy` → medium link deserves a note: since no association can target the abstract base,
`Copy.MediumId` stays a bare Guid and each medium entity carries an **unmanaged backlink**
(`Copies : Association to many Copy on Copies.MediumId = Id`). `$expand=Copies` therefore works on
all seven sets, but the reference model's referential constraint on that relationship does not exist.
(Referential constraints as such are covered - 9 of them are emitted, e.g. `Loan` → `Copy` over the
composite key.)

An unintended benefit: because the media-bound operations are declared once per concrete type, the
metadata ends up with **seven bindings** of `AvailableCopies` - which happens to reproduce the
reference model's "overload on the binding-type axis" test case, just not for the reason intended.

### G3 - One flat schema per service ❌

The reference model uses four namespaces (`Library.Catalog`, `Library.Circulation`,
`PublisherRegistry`, `Library.Service`) and deliberately declares **two different types named
`Branch`** in two of them (odata2ts#222).

CAP emits exactly one `<Schema>` per service. Everything lands in `Library.Service`, so the name
collision is unrepresentable - `PublisherRegistry.Branch` had to be renamed `PublisherBranch`
([db/publishers.cds](db/publishers.cds)). Cross-namespace operation binding likewise evaporates:
there is only one namespace to bind within.

### G4 - No operation overloads ❌

The reference model declares `Search` twice (parameter axis) and `AvailableCopies` twice (binding-type
axis). CDS rejects a duplicate operation name at compile time.

Resolution: only the richer `Search(Term, MaxResults)` signature exists, with `MaxResults` optional at
runtime. Both `GET /Search(Term='Der')` and `GET /Search(Term='Der',MaxResults=2)` return 200, but
`$metadata` advertises a single `<Function>`. Leaving the duplicate in would be a compile error - a
programming error rather than an interesting one - so it was removed rather than kept.

### G5 - `IsComposable` is always `false` ❌

`NewReleases` and both `AvailableCopies` overloads are `IsComposable="true"` in the reference model.
CAP hardcodes `IsComposable="false"` on every `<Function>`; no annotation changes it.

Interestingly `GET /NewReleases()?$top=1` still returns 200 - CAP applies the query option even
though its metadata says it may not (odata2ts#346). Metadata and behaviour disagree.

### G6 - Alternate keys are advertised but not resolved 🔶

`@Core.AlternateKeys` renders **correctly** into `$metadata` (six occurrences, on the three print-media
sets). The runtime ignores it: `GET /Books(ISBN='9783150094440')` → **400**.

Kept deliberately - it is the clearest example in this server of metadata promising something the
runtime does not deliver.

### G7 - No `<EnumType>`, therefore no `IsFlags` and no `has` ❌

`AvailabilityStatus` (underlying type `Edm.Byte`) and the `IsFlags` enum `Amenities` both render as
their **underlying primitive** plus a `Validation.AllowedValues` annotation listing the symbolic
names. Zero `<EnumType>` elements are emitted.

- `GET /Copies?$filter=Status eq 1` → 200 (works, but as a plain integer comparison)
- `GET /Branches?$filter=Amenities has 2` → **400**, no `has` operator without a flags enum

The non-ASCII member name `Café` survives (escaped `![Café]` in CDL) and appears in the annotation;
the non-power-of-two combined member `FullService = 31` survives as a value but means nothing without
`IsFlags`.

Related: `@odata.etag` on `Copy.Condition` produces `Core.OptimisticConcurrency` with an **empty**
`<Collection/>` rather than listing `Condition` as a `PropertyPath`. The runtime behaviour is
nonetheless correct (see "What works" below) - only the annotation content is wrong.

### G8 - No containment ❌

`Audiobook.Chapters` is `ContainsTarget="true"` in the reference model, and `AudiobookChapter` has no
entity set of its own. CAP emits **zero** `ContainsTarget` attributes and requires the target to be
exposed as a regular entity set.

Verified that this is not a configuration matter: compiling with `--odata-containment=true`, both with
an unmanaged composition and with a managed composition-of-aspect, changes nothing.

Navigation itself works - `GET /Audiobooks(<id>)/Chapters` returns 200 - it is simply not containment.

### G9 - Media entities vs. stream properties 🔶

The reference model marks `EBook` and `AudiobookChapter` with `HasStream="true"` (the entity _is_ the
stream) and gives `Audiobook` a _named_ stream property `Sample`.

CAP has no `HasStream`: **zero** occurrences in the metadata. It models streams only as properties -
`@Core.MediaType` on a `LargeBinary` yields `Edm.Stream` (three of them here).

The runtime behaviour is good: upload and download work for both shapes.

```
PUT /EBooks(<id>)/content        -> 204
GET /EBooks(<id>)/content        -> 200
PUT /Audiobooks(<id>)/Sample     -> 204
GET /Audiobooks(<id>)/Sample     -> 200
```

So the _named stream property_ case is fully reproduced; only the _media entity_ case is not.

### G10 - OData 4.01 constructs in a 4.0 document ❌

The reference model is `Version="4.01"`, which `Edm.Untyped` requires. CAP always emits
`Version="4.0"` - yet happily renders `Edm.Untyped` when asked to via `@odata.Type`.

The result is a **self-inconsistent metadata document**: a 4.01-only type declared inside a document
claiming 4.0 conformance. This is the one place where CAP produces something a strict client may
legitimately reject. Kept deliberately, since exposing exactly this kind of thing is the point of the
model.

### G11 - `<TypeDefinition>` is inlined ❌

`type ISBN : String(13)` does not survive as `<TypeDefinition Name="ISBN" UnderlyingType="Edm.String"
MaxLength="13"/>`. CAP inlines it: the property renders as `Edm.String` with `MaxLength="13"`.
Zero `<TypeDefinition>` elements are emitted.

### G12 - The `Unicode` facet is dropped ❌

`@odata.Unicode: false` on `Copy.Location_` is silently ignored - zero `Unicode=` attributes in the
output, where the reference model has `Unicode="false"`.

The property name itself is preserved, so the intended trailing-underscore collision with the
`Location` navigation property (odata2ts#142) is still testable.

### G13 - Exotic types: metadata only, no runtime typing 🔶

CAP has no CDS types for the spatial family, `Edm.Duration`, `Edm.SByte`, `Edm.Single` or
`Edm.Untyped`. All of these are declared via the documented `@odata: { Type: …, SRID: … }` override,
which places the **correct type and SRID in `$metadata`** (6 × `Edm.Geography*`, 4 × `Edm.Geometry*`,
10 × `SRID=`, 1 × `Edm.Untyped`) while the underlying storage stays `String`/`Double`/`Int16`.

CAP performs **no conversion** - the values go out as whatever the column holds:

| Property                   | `$metadata` says                | Wire format actually delivered                 |
| -------------------------- | ------------------------------- | ---------------------------------------------- |
| `Branch.Location`          | `Edm.GeographyPoint` SRID 4326  | `"POINT (9.9937 53.5511)"` (WKT string)        |
| `Branch.FloorPlanShapes`   | `Edm.GeometryCollection` SRID 0 | WKT string                                     |
| `Audiobook.Duration`       | `Edm.Duration`                  | `"PT9H14M"` - happens to be valid              |
| `CollectorsItem.ExtraData` | `Edm.Untyped`                   | JSON _as a quoted string_, not as a JSON value |
| `Copy.WeightKg`            | `Edm.Single`                    | JSON number - fine                             |
| `Branch.LowestFloor`       | `Edm.SByte`                     | JSON number - fine                             |

A conforming client will reject the geography and untyped payloads. This is the intended finding, and
the reason the model puts these types on peripheral entities: they do not poison the domain core.

### G14 - Decimal is serialised as a string 🔶

Not a reference-model feature, but a notable deviation found while testing. `Loan.LateFee`
(`Decimal(5,2)`) is delivered as `"LateFee": "4.50"` - a **string** - in entity payloads, while the
same value returned from the `OutstandingBalance` function comes back as the number `29.5`.

OData JSON delivers `Edm.Decimal` as a number unless the client asks for
`IEEE754Compatible=true`. CAP does neither consistently.

---

## What works

Everything below was verified against the running service.

### Operations - complete ✅

All 29 operations of the reference model exist and return correctly shaped payloads. The full
bound × unbound × return-type matrix is covered:

| Return type             | Unbound                                   | Bound                             |
| ----------------------- | ----------------------------------------- | --------------------------------- |
| _(none)_                | `ClosureDay` → 204                        | `CheckOut` → 204                  |
| primitive               | `NextInventoryNumber`                     | `OutstandingBalance`, `Reserve`   |
| `Collection(primitive)` | `AllLanguages`, `CleanUpKeywords`         | `AvailableLanguages`, `BulkRenew` |
| complex                 | `LoanStatistics`, `YearEndClosing`        | `LoanMetrics`, `AssessCondition`  |
| `Collection(complex)`   | `StatsPerBranch`, `RunOverdueNotices`     | `NoticeHistory`, `RunReminders`   |
| entity                  | `MostReadMedium`, `AcquireCollectorsItem` | `AvailableCopy`, `Renew`          |
| `Collection(entity)`    | `NewReleases`, `Search`, `RunStockCheck`  | `AvailableCopies`, `RenewAll`     |

Also working: complex-typed **parameters** (`LoanStatistics(Period=@p1)`, exercising `@p1` aliasing -
odata2ts#285/#291), collection **parameters** (`CleanUpKeywords`, odata2ts#72), binding to a
collection (`in : many $self`), and `EntitySetPath` - which CAP derives **automatically** for
entity-returning bound operations (`Renew`, `RenewAll` both carry `EntitySetPath="in"`).

One caveat: bound operations declared in the **db layer** are silently dropped by `as projection on`.
They must be declared on the service entity. This cost a compile-clean but empty metadata before it
was spotted, and is why every `actions {}` block lives in [srv/library-service.cds](srv/library-service.cds).

### Model features ✅

| Feature                                           | Note                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Composite keys                                    | `Copy(MediumId, InventoryNumber)`                                                            |
| Referential constraints                           | 9 emitted, incl. the composite `Loan` → `Copy`                                               |
| `OnDelete Cascade`                                | 3 emitted, from CDS compositions                                                             |
| Singleton                                         | `MainBranch`, `@odata.singleton`                                                             |
| Open type                                         | `CollectorsItem`, `@open` → `OpenType="true"`                                                |
| `Collection(primitive)`                           | `Medium.Keywords`                                                                            |
| `Collection(complex)`                             | `Member.PreviousAddresses` - and the only reason a `PostalAddress` ComplexType exists at all |
| `DefaultValue`                                    | `Copy.IsLoanable`                                                                            |
| `Core.Computed`                                   | `Medium.PopularityScore`                                                                     |
| `Capabilities.SearchRestrictions`                 | honoured - `$search` actually works                                                          |
| Facets `MaxLength`/`Precision`/`Scale`/`Nullable` | preserved                                                                                    |
| `Edm.Binary`                                      | `IdDocument.Scan`, incl. `/$value`                                                           |
| Uni- vs. bidirectional navigation                 | `CollectorsItem.StorageLocation` has no partner                                              |
| `NavigationPropertyBinding`                       | emitted for every target                                                                     |

### Protocol ✅

| Scenario                                                                  | Result                                  |
| ------------------------------------------------------------------------- | --------------------------------------- |
| `$filter`, `$orderby`, `$top`, `$skip`, `$count`, `$search`               | 200                                     |
| `$count` segment (`/Books/$count`)                                        | 200                                     |
| `$expand`, incl. `$expand=Copies($count=true;$top=1)` (odata2ts#344/#371) | 200                                     |
| `$apply=groupby((Status),aggregate($count as Count))`                     | 200                                     |
| 16-value `in()` chain (odata2ts#337)                                      | 200, no recursion limit                 |
| `$batch`, both JSON and multipart (odata2ts#253)                          | 200                                     |
| Deep insert (audiobook + chapters in one POST)                            | 201                                     |
| `@odata.bind`                                                             | 201                                     |
| ETag round trip: 428 without `If-Match`, 200 with, 412 when stale         | correct                                 |
| Explicit `null` vs. omitted property (odata2ts#257/#218)                  | `ReturnedAt: null` delivered explicitly |
| `$expand` on a non-navigation property rejected (odata2ts#372/#379)       | 400 - correct                           |

The last two rows are **passes**: the server does the right thing.

### Additional protocol gaps ❌

| Scenario                                                        | Result                                             |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `POST /Books/$query` with `text/plain` body (odata2ts#383/#388) | **400**                                            |
| `$ref` relationship management                                  | **404**                                            |
| Function/action imports in the service document                 | absent - CAP never sets `IncludeInServiceDocument` |

---

## Out of scope

The companion torture fixture
[`odata-test-data-model-quirks.xml`](../../odata-test-data-model-quirks.xml) - property names
containing a space or a slash, and an `EnumType` with zero members - is **not** implemented. Those
constructs are deliberately CSDL-invalid; the CDS compiler will not emit them, and forcing them would
require post-processing the generated EDMX, which would say nothing about CAP itself.
