/**
 * Shared types of the "Library" test model - namespace `Library.Catalog`.
 *
 * Kept in a separate file so that `circulation.cds` can use them without pulling in
 * `catalog.cds`, which in turn depends on circulation (media -> Copy backlinks).
 * Dependency direction: common <- circulation <- catalog, plus common <- catalog.
 */
namespace Library.Catalog;

/**
 * Reference model: `<TypeDefinition Name="ISBN" UnderlyingType="Edm.String" MaxLength="13"/>`.
 * CAP inlines named aliases for primitives - this renders as `Edm.String MaxLength="13"`,
 * no `<TypeDefinition>` is emitted (FEATURE-COVERAGE.md §2.3).
 */
type ISBN : String(13);

/**
 * Reference model: abstract ComplexType `Address`, extended by `PostalAddress`.
 *
 * CAP flattens a structured element used directly on an entity into columns (`Address_Street`, ...),
 * because the entity maps to a table and the OData view inherits that shape; capire recommends
 * keeping models "as flat as possible". A real `<ComplexType>` is emitted where there is no column
 * equivalent: as a collection (`many PostalAddress`) or in an operation signature.
 * See FEATURE-COVERAGE.md §2.1, which also documents the `cds.odata.structs` alternative.
 */
type Address {
  Street : String(120);
  City   : String(80);
}

type PostalAddress : Address {
  PostalCode : String(10);
  Country    : String(60);
}

type ConditionReport {
  ConditionBefore : UInt8;
  ConditionAfter  : UInt8;
  Remark          : String;
}

type MediumStats {
  TotalLoanCount      : Int64;

  /** No CDS type maps to Edm.Duration; handlers emit ISO 8601, which is conformant (�3.2). */
  @odata.Type: 'Edm.Duration'
  AverageLoanDuration : String;
}

/**
 * Reference model: `<EnumType Name="AvailabilityStatus" UnderlyingType="Edm.Byte">`.
 *
 * In CDS an enum is a *constraint on a value*, not a type of its own: the element renders as its
 * underlying primitive (`Edm.Byte`) plus a `Validation.AllowedValues` annotation carrying the
 * symbolic names. See FEATURE-COVERAGE.md §1.3.
 */
type AvailabilityStatus : UInt8 enum {
  Available = 0;
  OnLoan    = 1;
  InRepair  = 2;
  Missing   = 3;
}

/**
 * Reference model: `<EnumType Name="Amenities" IsFlags="true">` with the deliberately
 * non-power-of-two combined member `FullService = 31` and the non-ASCII member `Café`.
 *
 * Both members survive as values (the non-ASCII identifier escaped as `![Café]` in CDL). What does
 * not survive is `IsFlags`, and with it the `has` operator - a real loss of query capability rather
 * than just a different rendering. FEATURE-COVERAGE.md §1.3.
 */
type Amenities : Integer enum {
  WheelchairAccessible = 1;
  Parking              = 2;
  ![Café]              = 4;
  KidsArea             = 8;
  StudyRoom            = 16;
  FullService          = 31;
}
