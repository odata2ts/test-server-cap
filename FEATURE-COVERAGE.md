# CAP and the "Library" OData V4 test model

How far SAP CAP (Node.js) can reproduce
[`model/library.xml`](https://github.com/odata2ts/test-reference-model/blob/main/model/library.xml), and — more
interestingly — **where it deliberately does something else**.

Measured against **@sap/cds 10.0.3** / **@sap/cds-dk 10.0.5**, Node 26, `@cap-js/sqlite` 3.
Every statement below was verified against the compiled `$metadata` and against the running service.

## How to read this document

The reference model is a deliberately feature-dense construct: it exists to probe the outer edges of
the OData V4/4.01 specification, and it packs features together in combinations no real domain would
produce. It is a **probe, not a benchmark**, and it carries its own authors' assumptions about what
matters. A model like that is bound to over-weight parts of the spec that a given framework has good
reasons to leave alone.

And an OData server does not have to implement all of OData. The spec is large, much of it is
optional, and conformance levels exist precisely because implementations are expected to pick.
"CAP does not do X" is therefore only interesting once we know **whether CAP solves the same problem
differently**.

So this document is ordered accordingly:

1. **[CAP's own approach](#1-caps-own-approach)** — the design decisions that make parts of the
   reference model inapplicable rather than unsupported
2. **[Structural deviations](#2-structural-deviations)** — where CAP's EDM differs in shape
3. **[Data types](#3-data-types)** — which EDM types have no CDS counterpart, and what a workaround
   actually buys
4. **[Operations and protocol](#4-operations-and-protocol)** — the part that maps almost cleanly
5. **[Overview](#5-overview)** — the feature-by-feature verdict

---

## 1. CAP's own approach

CAP is not an OData framework that happens to have a modelling language. It is a domain-modelling
framework that emits OData as **one of several projections** of the domain model. capire calls these
projections _reflections_, and says outright that they involve
"some loss of information" — SQL DDL reflects persistence, OData EDMX reflects the service interface,
GraphQL reflects a further-reduced interface. The domain model is intentionally richer than any of
them.

That single premise explains most of what follows.

### 1.1 Aspects instead of inheritance

The reference model's centrepiece is a four-level entity hierarchy
(`Medium` → `PrintMedium` → `Magazine` → `TradeJournal`) with abstract bases and a single entity set
over the abstract root.

CDS has no entity inheritance, and this is a decision, not an omission. capire is explicit on all
three points:

- On the `:` include syntax: _"Looks Like Inheritance … The `:` based syntax for includes looks very
  much like (multiple) inheritance and in fact has very much the same effects. Yet, it is not based
  on inheritance but on **mixins**, which are more powerful."_ Mixins avoid the diamond problem while
  giving multiple-inheritance-like reuse.
- On class hierarchies: CDS _"intentionally doesn't provide any automatic mapping"_ of class
  hierarchies to relational schemas. The modeller picks table-per-leaf-class, table-per-class or
  single-table explicitly.
- On abstract types: **`abstract entity` is deprecated**, explicitly _"to encourage the use of the
  Separate Reuse Aspects pattern instead"_.

This is composition-over-inheritance applied to data modelling, and it is aspect-oriented in the
literal sense: aspects exist so that secondary concerns (audit fields, UI annotations, extensibility)
can be layered onto a definition from elsewhere, keeping the core domain model _"concise and
comprehensible"_.

**What this server does:** `Medium`, `PrintMedium`, `MagazineLike` and `AudioMedium` are aspects
([db/catalog.cds](db/catalog.cds)); the seven concrete media are entities that mix them in. The
element structure of the reference model is reproduced exactly. What is absent is the _type
relationship_ between them.

**What follows from it — and is therefore not a defect:**

| Reference model feature                                | Why it does not apply                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `Abstract="true"` entity types                         | Nothing to be abstract over; the pattern is deprecated in CDS           |
| `BaseType=`                                            | Mixins leave no base type behind                                        |
| Entity set over an abstract root                       | Each concrete type gets its own set — the table-per-leaf-class strategy |
| Type-cast path segments (`Media/Library.Catalog.Book`) | No subtype to cast to                                                   |
| `@odata.type` discriminators on write                  | Nothing to discriminate; accepted and ignored                           |
| `cast()` in `$filter` over the hierarchy               | Same                                                                    |

The trade is real and worth naming: you gain a flat, queryable, relationally honest schema; you lose
polymorphic access ("give me all media regardless of kind"). For a library domain that would hurt.
The reference model happens to want exactly the thing CAP gave up.

One incidental effect: because media-bound operations are declared per concrete type, the metadata
ends up with **seven bindings** of `AvailableCopies` and `AvailableCopy` — which is, structurally,
the reference model's "overload on the binding-type axis" case.

### 1.2 Compositions instead of containment

The reference model marks `Audiobook.Chapters` `ContainsTarget="true"`, so chapters exist only inside
their audiobook.

CAP expresses the same intent with **compositions**, its modelling primitive for
document structures: a composition means "part of", implies cascading delete, and drives deep insert
and deep update. CAP emits no `ContainsTarget` and exposes the target as a regular entity set.

Behaviourally the important half is there:

```
POST /Audiobooks  {"Title":"…","Chapters":[{"Id":1,"Title":"Kapitel A"}]}   -> 201, deep insert
GET  /Audiobooks(<id>)/Chapters                                             -> 200
DELETE the audiobook                                                        -> chapters go too
```

What is missing is the _addressing_ guarantee — chapters are also reachable directly at
`/AudiobookChapters`. Verified that this is not a configuration matter: `cds.odata.containment` has
no effect in cds 10, with either an unmanaged composition or a managed composition-of-aspect.

**Deep writes follow the same line**, and capire states the rule directly: compositions → _"runtime
deeply creates or updates entries in target entities"_, associations → _"runtime fills in foreign keys
to existing target entries"_
([capire, Deep Insert](https://cap.cloud.sap/docs/guides/services/served-ootb#deep-insert)).

The discriminator is therefore the relationship **kind**, not the cardinality: the very same nested
object is a child in one case and a reference in the other. Worth writing down is how differently that
rule presents itself — measured against this model:

| Nested payload for …                                        | Result                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| to-many composition `Audiobooks/Chapters`                   | 201, children created and linked, `up__Id` filled in from the parent                                                     |
| to-one composition `Members/IdDocument`                     | 201, the document is created — the same nested shape that a to-one _association_ refuses two rows below                  |
| to-one association `Copies/Location`, key only (`{"Id":1}`) | 201, foreign key `Location_Id` set — no `Branch` created, exactly as documented                                          |
| to-one association, empty object (`{}`)                     | 201, no-op                                                                                                               |
| to-one association, any non-key property                    | **400** `Property "Name" does not exist in Location` — also when the key is present alongside it                         |
| to-many association `Books/Copies`                          | **201, and the payload is dropped in silence** — it is not even validated: `{"TotalNonsense":42}` passes just as quietly |

The last two rows are the sharp edge, and neither is visible in `$metadata`: the same construct — a
nested object on a navigation property — is a hard 400 in one case and a silent no-op in the other,
while a server that models the relationship as containment creates the entity in both. A generated
client that types navigation properties as writable can therefore emit payloads that are correct per
EDM and still rejected or ignored here.

The asymmetry has a logic once the rule is in view: for a to-one association the foreign key sits on
the entity being written, so a key is something the runtime can act on; for a to-many it sits on the
child, so there is nothing on this side to fill in. Only the silence is surprising.

The first two rows are why `Member.IdDocument` is modelled as a **composition** here while every other
to-one relationship is an association ([db/circulation.cds](db/circulation.cds)). EDMX cannot express
the distinction — the reference model's plain navigation property permits either reading — and an
identity document is the one relationship in this model where "part of" is the honest one: it belongs
to exactly one member and should go when the member does. Without it the two rows that matter most
here could not be told apart on this server at all, since cardinality is not the discriminator.

That choice has a price, and it is the only one: CAP emits `<OnDelete Action="Cascade"/>` on the
navigation property, where the reference model declares none. Deleting a member therefore removes the
document (verified: 204, then 404 on the document). Everything else is untouched — the `IdDocument_Id`
foreign key, the `IdDocuments` entity set, and `Scan/$value` upload and download all behave as before,
and the emitted metadata differs in that single line.

### 1.3 Enums as constraints, not as types

`AvailabilityStatus` and the `IsFlags` enum `Amenities` render as their **underlying primitive**
plus a `Validation.AllowedValues` annotation carrying the symbolic names. No `<EnumType>` is emitted.

This fits the reflection idea: in CDS an enum is a _constraint on a value_, enforced via
`@assert.range`, not a distinct type in the type system. The vocabulary annotation preserves the
symbolic names for any client that cares to read them.

The cost is concrete and lands in the "real gap" column, because it removes query capability rather
than just renaming things: without a flags enum there is no `has` operator
(`$filter=Amenities has 2` → 400). The non-ASCII member `Café` and the non-power-of-two member
`FullService = 31` both survive as values.

### 1.4 One service, one schema

The reference model uses four namespaces and deliberately declares two different types named
`Branch`. CAP emits one `<Schema>` per service, named after the service.

This is a coherent position — a service is the unit of API design, and one namespace per service
keeps client-side name resolution trivial — but it does mean the duplicate type name is
unrepresentable. `PublisherRegistry.Branch` is called `PublisherBranch` here
([db/publishers.cds](db/publishers.cds)). Cross-namespace operation binding dissolves for the same
reason: there is only one namespace.

### 1.5 Where CAP simply follows the spec

Worth stating explicitly, because it is easy to lose in a gap list. These are spec features CAP
implements as written, several of which the reference model treats as exotic:

**Open types** — yes, fully. `@open` on an entity yields `OpenType="true"`, and undeclared
properties pass through. `CollectorsItem` uses it.

Also: singletons (`@odata.singleton`), composite keys, referential constraints (9 emitted, including
the composite `Loan` → `Copy`), `OnDelete Cascade`, `Collection(primitive)`, `Collection(complex)`,
`DefaultValue`, `Core.Computed`, `Capabilities.SearchRestrictions` (honoured — `$search` works),
`Core.AlternateKeys` (in metadata), the `MaxLength`/`Precision`/`Scale`/`Nullable` facets, `Edm.Binary`
with `/$value`, unidirectional navigation, and `NavigationPropertyBinding` for every target.

---

## 2. Structural deviations

Distinct from §1: these are places where CAP models the _same_ concept as OData, but shapes the EDM
differently.

### 2.1 Structured elements are flattened — by default

`Member.Address` (type `PostalAddress`) becomes four properties: `Address_Street`, `Address_City`,
`Address_PostalCode`, `Address_Country`. No `<ComplexType>` is used for it.

The reason is the relational projection. A CDS entity maps to a table; a structured element has no
table representation, so it unfolds into columns, and the OData reflection inherits that shape.
capire recommends it directly: _"Although CAP supports structured types and elements, we recommend
using them only if they bring real benefit. In general, you should keep your models as flat as
possible."_

Complex types are **not** absent from the metadata — eight are emitted, wherever the type appears in
a position that has no column equivalent:

`Library_Catalog_PostalAddress` · `Library_Catalog_MediumStats` · `Library_Catalog_ConditionReport` ·
`Library_Circulation_OverdueNotice` · `Library_Circulation_LoanStats` · `Library_Circulation_DateRange` ·
`Library_Circulation_BranchStats` · `Library_Circulation_AnnualReport`

That is: as a **collection** (`Member.PreviousAddresses`) and as operation **parameters and return
types**. Note the namespace-mangled names.

**Structured mode is available, and its trade-off is precise.** Setting `cds.odata.structs` (or the
`x4` flavour) changes the metadata substantially — verified:

|                                                      | default (flat)          | `cds.odata.structs`                      |
| ---------------------------------------------------- | ----------------------- | ---------------------------------------- |
| `Member.Address` in `$metadata`                      | 4 flat properties       | one `PostalAddress` complex property     |
| Foreign key properties                               | present                 | gone                                     |
| `$select=Address`, `$select=Address/City`            | **400**                 | **200**                                  |
| `$filter=Address/City eq …`, `$orderby=Address/City` | 400                     | **200**                                  |
| JSON payload                                         | `"Address_Street": "…"` | `"Address_Street": "…"` — **still flat** |

So structured mode buys spec-conformant metadata _and_ spec-conformant query syntax, but the payload
keeps the flat property names, which then do not exist in the type the metadata declares. Metadata
and payload disagree — which is presumably why capire marks the setting deprecated and "likely to be
removed with the next major release".

**This server keeps the default.** Flat metadata plus flat payload is at least self-consistent, and
it is the path CAP actually recommends. The consequence is that the deep-`$select`-into-complex-type
scenario returns 400 here.

### 2.2 Foreign keys appear next to navigation properties

For a managed association, CAP emits **three** things where OData needs one:

```xml
<NavigationProperty Name="Publisher" Type="Library.Service.Publishers" Partner="Books">
  <ReferentialConstraint Property="Publisher_Id" ReferencedProperty="Id"/>
</NavigationProperty>
<Property Name="Publisher_Id" Type="Edm.Int32"/>
```

The `Publisher_Id` property has no counterpart in the reference model, which exposes only the
navigation property. It is the flattening rule of §2.1 applied to associations: the association's
foreign key is a real column, so it surfaces as a real property.

This is additive rather than lossy — navigation still works, and the referential constraint is
correctly declared — but it does widen every entity type, and a generated client will see key
properties it has no use for. `cds.odata.refs` is documented as suppressing them; in cds 10 it had no
effect in isolation, and the FK properties only disappear together with structured mode (§2.1).

Same pattern on `Copy.Location` → `Location_Id`, which sits next to the unrelated string property
`Location_` from the reference model.

### 2.3 Type definitions are inlined

`type ISBN : String(13)` does not survive as `<TypeDefinition>`. It is resolved at compile time and
the property renders as `Edm.String MaxLength="13"`.

Consistent with §1's reflection idea — a named alias for a primitive carries no information the
service interface needs — but it does mean a client cannot recover the domain vocabulary.

### 2.4 Streams are properties, never media entities

The reference model uses both stream shapes OData offers: `EBook` and `AudiobookChapter` are marked
`HasStream="true"` (the entity _is_ the stream), while `Audiobook.Sample` is a _named_ stream
property alongside ordinary data.

CAP models only the second shape. `@Core.MediaType` on a `LargeBinary` element yields an
`Edm.Stream` property; `HasStream` is never emitted. So the named-stream case is reproduced exactly,
and the media-entity case is re-expressed as a property (`content`) on an otherwise normal entity.

The behaviour is equivalent in practice — both shapes upload and download cleanly:

```
PUT/GET /EBooks(<id>)/content       -> 204 / 200
PUT/GET /Audiobooks(<id>)/Sample    -> 204 / 200
```

What a client loses is the signal that the entity's _own_ representation is a stream, which affects
how a generated client models the type.

### 2.5 Facets and annotations that do not survive

`@odata.Unicode: false` on `Copy.Location_` is dropped; no `Unicode=` attribute is emitted. Minor,
and the property name itself is preserved.

`@odata.etag` produces `Core.OptimisticConcurrency` with an **empty** `<Collection/>` rather than
listing `Condition` as a `PropertyPath`. The runtime behaviour is nonetheless fully correct
(428 / 200 / 412, see §4.2) — only the annotation content is wrong, so a client reading metadata to
discover the ETag property learns nothing.

### 2.6 The managed-property terms — one of three is enforced

Written straight through: `@Core.Immutable` on `Loan.LoanedAt` reaches the projection and is emitted
against the service-level target, under the `Core` alias CAP declares in its `edmx:Reference`.

```xml
<Annotations Target="Library.Service.Loans/LoanedAt">
  <Annotation Term="Core.Immutable" Bool="true"/>
</Annotations>
```

Unlike every other annotation in this section, this one is not just metadata. CAP's generic input
validation knows the term — `_is_immutable()` covers `@Core.Immutable` and `@insertonly` — and on an
update it **deletes the property from the payload** before any handler sees it
(`lib/req/validate.js`, the `cleanse` branch). The value is dropped silently: no error, no warning, and
the response carries the stored value. Insert is untouched, which is exactly the term's semantics.

Two limits are worth recording. The cleansing runs for the **root entity only** — a nested row of a
deep update is left to the database layer, which CAP itself flags as a REVISIT — and it is skipped
during draft activation, which is why `libx/_runtime/common/generic/input.js` repeats the check.

**The other two are metadata only.** `@Core.ComputedDefaultValue` on `Member.ActiveSince` and
`@Core.Permissions: #Read` on `Member.Balance` render exactly as declared — the enum value flat on the
annotation, as the vocabulary defines it, which is not what ASP.NET Core does with the same term:

```xml
<Annotations Target="Library.Service.Members/ActiveSince">
  <Annotation Term="Core.ComputedDefaultValue" Bool="true"/>
</Annotations>
<Annotations Target="Library.Service.Members/Balance">
  <Annotation Term="Core.Permissions" EnumMember="Core.Permission/Read"/>
</Annotations>
```

Neither changes what the runtime accepts. `_is_readonly()` consults `@readonly`, `@cds.on.insert`,
`@cds.on.update`, `@Core.Computed` and `@Common.FieldControl` — **not** `@Core.Permissions` — and
nothing generates a value for a `ComputedDefaultValue` property that arrives without one. Measured:

```
PATCH Members(1)  {"Balance": "999.99", "ActiveSince": "1999-01-01T00:00:00Z"}   200, both written
```

So a read-only property is writable in practice. `@readonly` is the annotation that would actually
hold, and it is a different statement — CAP's own vocabulary rather than the standard term the
reference model uses.

Worth noting alongside: CAP emits `Core.ComputedDefaultValue` **by itself** on every UUID key it
manages (`Reservations/Id` and the rest), without anything in the model asking for it. An `Integer` key
gets nothing, so those carry the term by hand — which is how every key in this service ends up stating
who supplies it.

Every key but one. `Branches/Id` is a branch code the organisation allocates, so it stays unannotated
and unlisted in `srv/handlers/keys.ts`: a create without it is a create with no key, and fails. That is
deliberate and is what the reference model asks of this entity — without a key the client owns, every
key in the service would look alike to one reading `$metadata`, and there would be nothing to tell a
key it must supply from one it must not. `Copies` is the composite case of the same thing.

---

## 3. Data types

The reference model instantiates every EDM primitive. That is a demanding bar for any framework:
no general-purpose type system covers the OData primitives exactly, and CDS types are chosen to map
cleanly onto SQL column types across HANA, PostgreSQL and SQLite.

The question worth asking is therefore not "how many of the 20 EDM types are present" but **what
kind of gap each one is**, and what a workaround actually costs.

CAP offers one: `@odata: { Type: 'Edm.…', SRID: … }` overrides the declared type in `$metadata`
without touching storage. capire is candid about the consequence: _"No automatic data modification
occurs… You must perform all required modifications so values match their type in the API."_

That splits the missing types into three genuinely different categories.

### 3.1 Directly supported

`Edm.String`, `Edm.Boolean`, `Edm.Guid`, `Edm.Int16/32/64`, `Edm.Byte`, `Edm.Double`, `Edm.Decimal`
(with precision and scale), `Edm.Date`, `Edm.TimeOfDay`, `Edm.DateTimeOffset`, `Edm.Binary`,
`Edm.Stream`, and `Collection(…)` of any of them. No workaround needed.

### 3.2 Missing type, workaround is complete

The type has no CDS equivalent, but a serialisation of it fits a CDS type exactly, so a type
override plus a small amount of handler code produces **fully conformant output**. This is a valid
workaround, not a compromise.

| EDM type       | Stored as | Handler work needed       | Result     |
| -------------- | --------- | ------------------------- | ---------- |
| `Edm.Duration` | `String`  | emit ISO 8601 (`PT9H14M`) | conformant |
| `Edm.SByte`    | `Int16`   | keep values in −128…127   | conformant |
| `Edm.Single`   | `Double`  | round to single precision | conformant |

This server does the first (see `isoDuration` in [srv/handlers/shared.ts](srv/handlers/shared.ts));
the other two are conformant already because the seed values are in range. The cost is that the
constraint lives in application code rather than in the model, so nothing enforces it.

### 3.3 Missing type, workaround is cosmetic

Here the override puts the right type in `$metadata` but the value on the wire is not a valid
instance of it. A conforming client will reject these. Making them conformant would mean writing a
serialiser per type — possible, but that is an application feature, not a framework capability.

| EDM type                                        | `$metadata` declares  | Actually delivered                               |
| ----------------------------------------------- | --------------------- | ------------------------------------------------ |
| `Edm.GeographyPoint` / `LineString` / `Polygon` | correct type + `SRID` | `"POINT (9.9937 53.5511)"` — WKT string          |
| `Edm.GeometryPoint` / `GeometryCollection`      | correct type + `SRID` | WKT string                                       |
| `Edm.Untyped`                                   | `Edm.Untyped`         | JSON **as a quoted string**, not as a JSON value |

Spatial support is the substantial one: OData expects GeoJSON in payloads and offers
`geo.distance`/`geo.intersects`/`geo.length` in `$filter`. None of that exists, and none of it can be
annotated into existence — a real gap, and a defensible one for a framework whose supported databases
disagree about spatial types.

The reference model puts these types on peripheral entities (`Branch`, `Bookmobile`,
`CollectorsItem`) precisely so a server that cannot do them stays evaluable. That works here.

### 3.4 A version inconsistency

`Edm.Untyped` is an OData **4.01** type. CAP always declares `Version="4.0"` and yet renders
`Edm.Untyped` when the override asks for it. The resulting document is not self-consistent, and a
strict client may reject it. Kept deliberately — it is exactly the kind of thing this model exists to
surface.

### 3.5 `Edm.Decimal` serialisation

`Loan.LateFee` (`Decimal(5,2)`) is delivered as `"LateFee": "4.50"` — a **string** — in entity
payloads, while the same type returned from the `OutstandingBalance` function comes back as the
number `29.5`.

OData JSON delivers `Edm.Decimal` as a number unless the client requests
`IEEE754Compatible=true`. CAP does neither consistently. Not a reference-model feature, but a real
spec deviation, and one a generated client will trip over.

---

## 4. Operations and protocol

The part of the reference model that maps almost without friction.

### 4.1 Operations — complete

All 29 operations exist and return correctly shaped payloads. The full
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

Also working: complex-typed **parameters** (`LoanStatistics(Period=@p1)`, exercising `@p1` aliasing),
collection **parameters**, binding to a collection (`in : many $self`), and `EntitySetPath` — which
CAP derives **automatically** for entity-returning bound operations.

Two limits:

- **No overloads.** CDS rejects a duplicate operation name. `Search` exists once, with the richer
  signature and an optional second parameter; both `Search(Term='Der')` and
  `Search(Term='Der',MaxResults=2)` work, but `$metadata` advertises one function.
- **`IsComposable` is always `false`.** No annotation changes it. Curiously
  `GET /NewReleases()?$top=1` returns 200 anyway — CAP applies the query option its metadata says it
  will not accept. Behaviour exceeds the declaration.

One modelling constraint worth knowing: bound operations must be declared on the **service** entity.
`as projection on` does not carry `actions {}` blocks up from the db layer.

### 4.2 Protocol

| Scenario                                                          | Result                                  |
| ----------------------------------------------------------------- | --------------------------------------- |
| `$filter`, `$orderby`, `$top`, `$skip`, `$count`, `$search`       | 200                                     |
| `$count` segment (`/Books/$count`)                                | 200                                     |
| `$expand`, incl. `$expand=Copies($count=true;$top=1)`             | 200                                     |
| `$apply=groupby((Status),aggregate($count as Count))`             | 200                                     |
| 16-value `in()` chain                                             | 200, no recursion limit                 |
| `$batch`, both JSON and multipart                                 | 200                                     |
| Deep insert along a to-many composition (audiobook + chapters)    | 201, children created (§1.2)            |
| Deep insert along a to-one composition (member + id document)     | 201, child created (§1.2)               |
| Deep insert along a to-one association, key only                  | 201, foreign key filled in (§1.2)       |
| Deep insert along a to-one association, any other property        | 400 (§1.2)                              |
| Deep insert along a to-many association                           | 201, payload silently dropped (§1.2)    |
| `@odata.bind`                                                     | 201                                     |
| ETag round trip: 428 without `If-Match`, 200 with, 412 when stale | correct                                 |
| Explicit `null` vs. omitted property                              | `ReturnedAt: null` delivered explicitly |
| `$expand` on a non-navigation property rejected                   | 400 — correct                           |
| Streams: upload and download, media-style and named property      | 204 / 200                               |

Not implemented:

| Scenario                                        | Result                                        |
| ----------------------------------------------- | --------------------------------------------- |
| `POST /Books/$query` with `text/plain` body     | 400                                           |
| `$ref` relationship management                  | 404                                           |
| Alternate-key addressing `Books(ISBN='…')`      | 400 — annotation present, runtime ignores it  |
| `cast()` in `$filter`                           | 501 Not Implemented                           |
| Function/action imports in the service document | absent — `IncludeInServiceDocument` never set |

The alternate-key row is the sharpest case in this server of metadata promising what the runtime does
not deliver, which is why it is kept in [test/requests.http](test/requests.http).

One thing the deep-write probes turned up in passing, listed for honesty rather than as a verdict: a
foreign key pointing at a target that does not exist is accepted (`Location_Id: 987654` → 201), and so
is a `Copy` whose `MediumId` matches no medium. Whether that follows from the SQLite setup or from
`@assert.integrity` not being switched on was not investigated.

**A create that omits an integer key answers with the wrong entity** — the sharpest instance of the
response not being trustworthy, and the one place where this server puts a workaround in the way.
The reference model declares these keys plain: `Member.Id` is `Edm.Int32`, non-nullable, and **not**
`Core.Computed`, so nothing in CAP fills it in. The insert goes through regardless — SQLite treats
`PRIMARY KEY(Id)` on an `INTEGER` column as an alias for the rowid and assigns the next value
silently — so the row is written, but CAP never learns that value. It then reads the result back with
no key at hand and returns **201 with the first row of the set**:

```
POST /Members {"Name":"No Key"}   -> 201  {"Id":1,"Name":"Anna Berger"}   # a row that already existed
GET  /Members                     -> the new member is there, as Id 9002
```

It applies to every integer-keyed set (`Members`, `Branches`, `Bookmobiles`, `Publishers`,
`PublisherBranches`, `AudiobookChapters`), and it is not a deep-write matter at all — a plain create
with no nested data does it too, while a UUID-keyed entity answers correctly. Since the ASP.NET
implementation of the same model generates these keys, this server now does the same in a
before-CREATE handler ([srv/handlers/keys.ts](srv/handlers/keys.ts)), which is what lets CAP describe
what it created. A create that brings its own key is untouched.

---

## 5. Overview

**Realizable** answers "can you build this with CAP?" — ✅ yes, ❌ no.
**Approach** distinguishes following the OData spec from solving the problem CAP's own way.

### Modelling

| Feature                                         | Realizable | Approach | Note                                                                     |
| ----------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------ |
| Entity types, keys, composite keys              | ✅         | spec     |                                                                          |
| Associations, navigation properties             | ✅         | spec     | plus extra FK properties (§2.2)                                          |
| Referential constraints                         | ✅         | spec     | 9 emitted                                                                |
| `OnDelete Cascade`                              | ✅         | spec     | from compositions, incl. one the reference model does not declare (§1.2) |
| Singletons                                      | ✅         | spec     |                                                                          |
| **Open types**                                  | ✅         | spec     | `@open` → `OpenType="true"`                                              |
| Collections of primitives / complex types       | ✅         | spec     |                                                                          |
| Complex types                                   | ✅         | spec     | in collections and operation signatures                                  |
| Structured elements on entities                 | ✅         | **own**  | flattened to columns (§2.1)                                              |
| Type hierarchies                                | ✅         | **own**  | aspects/mixins, table-per-leaf-class (§1.1)                              |
| Abstract types                                  | ✅         | **own**  | replaced by reuse aspects; `abstract entity` deprecated                  |
| Document/part-of structures                     | ✅         | **own**  | compositions instead of containment (§1.2)                               |
| Enumerations                                    | ✅         | **own**  | `Validation.AllowedValues`, not `<EnumType>` (§1.3)                      |
| Named type aliases                              | ✅         | **own**  | inlined, no `<TypeDefinition>` (§2.3)                                    |
| **`Core.Immutable`**                            | ✅         | spec     | emitted **and** enforced — dropped from update payloads (§2.6)           |
| `Core.ComputedDefaultValue`, `Core.Permissions` | ✅         | spec     | emitted as declared, but neither is enforced (§2.6)                      |
| Multiple namespaces per service                 | ❌         | —        | one schema per service (§1.4)                                            |
| Flags enums and the `has` operator              | ❌         | —        | follows from §1.3                                                        |
| Alternate-key addressing                        | ❌         | —        | annotation renders, runtime ignores it                                   |
| `Unicode` facet                                 | ❌         | —        | dropped (§2.4)                                                           |

### Data types

| Feature                                                   | Realizable | Approach | Note                                                 |
| --------------------------------------------------------- | ---------- | -------- | ---------------------------------------------------- |
| String, Boolean, Guid, Int16/32/64, Byte, Double, Decimal | ✅         | spec     |                                                      |
| Date, TimeOfDay, DateTimeOffset                           | ✅         | spec     |                                                      |
| Binary, Stream                                            | ✅         | spec     | incl. `/$value` and stream upload                    |
| Named stream properties                                   | ✅         | spec     | `@Core.MediaType` on `LargeBinary`                   |
| Media entities (`HasStream`)                              | ✅         | **own**  | modelled as a stream property instead (§2.4)         |
| `Edm.Duration`, `Edm.SByte`, `Edm.Single`                 | ✅         | **own**  | type override + handler code; conformant (§3.2)      |
| Geography / Geometry family                               | ❌         | —        | WKT strings, no GeoJSON, no `geo.*` functions (§3.3) |
| `Edm.Untyped`                                             | ❌         | —        | delivered as a quoted string (§3.3)                  |
| OData 4.01 document version                               | ❌         | —        | 4.01 types inside a `Version="4.0"` document (§3.4)  |
| `Edm.Decimal` JSON representation                         | ❌         | —        | string in entities, number from functions (§3.5)     |

### Operations

| Feature                           | Realizable | Approach | Note                                             |
| --------------------------------- | ---------- | -------- | ------------------------------------------------ |
| Unbound functions and actions     | ✅         | spec     | all return-type variants                         |
| Bound functions and actions       | ✅         | spec     | incl. binding to collections                     |
| Actions without a return type     | ✅         | spec     |                                                  |
| Complex and collection parameters | ✅         | spec     | incl. `@p1` aliasing                             |
| `EntitySetPath`                   | ✅         | spec     | derived automatically                            |
| Operations on a type hierarchy    | ✅         | **own**  | declared per concrete type (§1.1)                |
| Operation overloads               | ❌         | —        | duplicate names rejected by the compiler         |
| `IsComposable`                    | ❌         | —        | always `false`, though query options still apply |
| Imports in the service document   | ❌         | —        | `IncludeInServiceDocument` never set             |

### Protocol

| Feature                                                     | Realizable | Approach | Note                                                                                                             |
| ----------------------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `$filter`, `$orderby`, `$top`, `$skip`, `$count`, `$search` | ✅         | spec     |                                                                                                                  |
| `$expand`, incl. nested `$count`/`$top`                     | ✅         | spec     |                                                                                                                  |
| `$apply` / `groupby`                                        | ✅         | spec     |                                                                                                                  |
| `$batch`, JSON and multipart                                | ✅         | spec     |                                                                                                                  |
| Deep insert, `@odata.bind`                                  | ✅         | spec     | along compositions; associations get their foreign key filled in, and a to-many one is dropped in silence (§1.2) |
| ETags / optimistic concurrency                              | ✅         | spec     | 428 / 200 / 412 all correct                                                                                      |
| Explicit `null` vs. omitted property                        | ✅         | spec     |                                                                                                                  |
| Streams                                                     | ✅         | spec     |                                                                                                                  |
| Deep `$select` into complex types                           | ❌         | —        | follows from §2.1; available in structured mode                                                                  |
| `cast()` in `$filter`                                       | ❌         | —        | 501                                                                                                              |
| `POST /$query`                                              | ❌         | —        | 400                                                                                                              |
| `$ref` relationship management                              | ❌         | —        | 404                                                                                                              |

---

## Conclusion

CAP reproduces the **protocol and operation surface** of the reference model essentially completely,
and it does so without special effort — all 29 operations, every return-type combination, `$batch`,
deep insert, ETags, streams, `$apply`.

Where it diverges, it mostly diverges **on purpose**. Inheritance, abstract types, containment and
enum types are not gaps; they are places where CAP solved the same modelling problem with mixins,
compositions and value constraints, and then projected that solution into EDM. Judging those as
missing features means judging CAP against a paradigm it explicitly rejected — and `abstract entity`
being _deprecated_ rather than _unimplemented_ is the clearest signal of that.

The genuine gaps are narrower than a first pass suggests, and they cluster: **spatial types** (no
GeoJSON, no `geo.*` functions), **flags enums and `has`**, **operation overloads**, **alternate-key
addressing**, and a handful of **spec inconsistencies** — `Edm.Decimal` as a string, 4.01 types in a
4.0 document, and `IsComposable` under-declaring what the runtime actually does. Those last ones
matter most for a typed client, because they are cases where the metadata cannot be trusted as a
contract.
