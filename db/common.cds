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
 * GAP G11: CAP inlines type definitions - this renders as a plain `Edm.String` with MaxLength 13,
 * no `<TypeDefinition>` element is emitted.
 */
type ISBN : String(13);

/**
 * Reference model: abstract ComplexType `Address`, extended by `PostalAddress`.
 * GAP G1: structured elements are flattened (`Address_Street`, ...) when used as a singular
 * element of an entity. A real `<ComplexType>` is only emitted where the type is used as a
 * collection (`many PostalAddress`) or as an operation parameter / return type.
 * GAP G2: there is no abstract-vs-concrete distinction - both render identically.
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

  /** GAP: no CDS type maps to Edm.Duration - metadata is overridden, values stay strings. */
  @odata.Type: 'Edm.Duration'
  AverageLoanDuration : String;
}

/**
 * Reference model: `<EnumType Name="AvailabilityStatus" UnderlyingType="Edm.Byte">`.
 * GAP G7: CAP does not emit `<EnumType>`. The element renders as its underlying primitive
 * (`Edm.Byte`) plus a `Validation.AllowedValues` annotation carrying the symbolic names.
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
 * GAP G7: no `<EnumType>`, therefore also no `IsFlags` and no support for the `has` operator.
 * The non-ASCII identifier itself survives (escaped as `![Café]` in CDL).
 */
type Amenities : Integer enum {
  WheelchairAccessible = 1;
  Parking              = 2;
  ![Café]              = 4;
  KidsArea             = 8;
  StudyRoom            = 16;
  FullService          = 31;
}
