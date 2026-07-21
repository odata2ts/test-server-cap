/**
 * Namespace `Library.Catalog` of the "Library" test model: the media hierarchy.
 *
 * The central modelling decision of this server (FEATURE-COVERAGE.md §1.1):
 * The reference model builds a four-level EDM inheritance chain
 * (`Medium` -> `PrintMedium` -> `Magazine` -> `TradeJournal`, plus `Medium` -> `AudioMedium` -> ...)
 * with `Abstract="true"` on the bases and a single entity set `Media` on the abstract root.
 *
 * CDS deliberately has no entity inheritance. Aspects are a *mixin* mechanism - capire: "not based
 * on inheritance but on mixins, which are more powerful" - and `abstract entity` is deprecated in
 * favour of the Separate Reuse Aspects pattern. CDS also "intentionally doesn't provide any
 * automatic mapping" of class hierarchies to relational schemas; the modeller picks a strategy.
 *
 * This model picks table-per-leaf-class: the aspects below reproduce the element structure exactly,
 * and every concrete medium becomes an independent entity with its own entity set. What is given up
 * is polymorphic access - and with it type-cast path segments, `@odata.type` discriminators and
 * `cast()` in `$filter`, none of which have anything to refer to.
 */
namespace Library.Catalog;

using {Library.Catalog} from './common';
using {Library.Circulation} from './circulation';
using {PublisherRegistry} from './publishers';

// ---------------------------------------------------------------------------------------------
// The media hierarchy, as aspects (reference model: abstract entity types)
// ---------------------------------------------------------------------------------------------

/** Reference model: `<EntityType Name="Medium" Abstract="true">`. */
aspect Medium {
  key Id              : UUID;
      Title           : String(200) not null;
      Language        : String(40);
      PublicationDate : Date;
      Keywords        : many String;

      @Core.Computed
      PopularityScore : Double;

      /**
       * Unmanaged backlink over the plain Guid column, so that `$expand=Copies` works on every
       * medium entity even though `Copy` cannot hold an association to the abstract base type.
       */
      Copies          : Association to many Circulation.Copy
                          on Copies.MediumId = Id;
}
// Bound operations are declared on the *service* projections (srv/library-service.cds), not here:
// `as projection on` does not carry `actions {}` blocks from the db layer into the service, and
// entity-returning operations must reference a service entity anyway. The reference model binds
// them to the abstract `Medium`; with FEATURE-COVERAGE.md �1.1 in force they are repeated per concrete medium.

/** Reference model: `<EntityType Name="PrintMedium" BaseType="Medium" Abstract="true">`. */
aspect PrintMedium : Medium {
  /** Alternate key in the reference model - see the `@Core.AlternateKeys` annotations in srv/. */
  ISBN : Catalog.ISBN;
}

/** Intermediate level so that `TradeJournal` sits four levels deep, as in the reference model. */
aspect MagazineLike : PrintMedium {
  IssueNumber : Integer;
}

/** Reference model: `<EntityType Name="AudioMedium" BaseType="Medium" Abstract="true">`. */
aspect AudioMedium : Medium {
  /** No CDS type maps to Edm.Duration; handlers emit ISO 8601, which is conformant (�3.2). */
  @odata.Type: 'Edm.Duration'
  Duration : String;
}

// ---------------------------------------------------------------------------------------------
// Concrete media
// ---------------------------------------------------------------------------------------------

entity Book : PrintMedium {
  PageCount : Int16;
  AgeRating : UInt8;
  Publisher : Association to PublisherRegistry.Publisher;
}

entity Magazine : MagazineLike {}

entity TradeJournal : MagazineLike {
  Field : String;
}

/** Reference model: media entity with a *named* stream property `Sample` next to containment. */
entity Audiobook : AudioMedium {
  Narrator : String;

  /** Named stream property - `@Core.MediaType` on LargeBinary renders as `Edm.Stream`. */
  @Core.MediaType: 'audio/mpeg'
  Sample   : LargeBinary;

  /**
   * Reference model: `<NavigationProperty Name="Chapters" ContainsTarget="true">` - the chapters
   * are addressable *only* through their audiobook and have no entity set of their own.
   * FEATURE-COVERAGE.md �1.2: CAP emits no `ContainsTarget`; `AudiobookChapter` gets a regular navigation property
   * and (once exposed) an own entity set. The `cds.odata.containment` flag is inert in cds 10 -
   * verified by compiling with `--odata-containment=true`, which changes nothing.
   */
  Chapters : Composition of many AudiobookChapter
               on Chapters.up_ = $self;
}

/** Reference model: `<EntityType Name="AudiobookChapter" HasStream="true">`. */
entity AudiobookChapter {
  key Id      : Integer;
  key up_     : Association to Audiobook;
      Title   : String;

      /**
       * FEATURE-COVERAGE.md �2.4: the reference model marks the *entity type* with `HasStream="true"` (a media
       * entity, whose stream is the entity itself). CAP instead models a stream-typed *property*.
       */
      @Core.MediaType: 'audio/mpeg'
      content : LargeBinary;
}

entity DVD : AudioMedium {
  RegionCode : UInt8;
}

/** Reference model: media entity (`HasStream="true"`) *inside* the inheritance hierarchy. */
entity EBook : Medium {
  FileFormat : String(20);

  /** See FEATURE-COVERAGE.md �2.4 - property-level stream instead of a media entity. */
  @Core.MediaType: 'application/epub+zip'
  content    : LargeBinary;
}

/** Reference model: open type derived from an abstract base, with a navigation property. */
@open
entity CollectorsItem : Medium {
  /**
   * `Edm.Untyped` is an OData **4.01** type. CAP happily renders it via the type override, but
   * declares the document as `Version="4.0"` - see FEATURE-COVERAGE.md �3.4: the emitted metadata is not
   * self-consistent.
   */
  @odata.Type: 'Edm.Untyped'
  ExtraData       : String;

  /** Unidirectional navigation (no partner), as in the reference model. */
  StorageLocation : Association to Circulation.Branch;
}

// ---------------------------------------------------------------------------------------------
// Backlinks added here to keep the file dependency graph acyclic
// ---------------------------------------------------------------------------------------------

extend PublisherRegistry.Publisher with {
  Books : Association to many Book
            on Books.Publisher = $self;
}
