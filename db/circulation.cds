/**
 * Namespace `Library.Circulation` of the "Library" test model:
 * members, copies, loans, branches - plus the complex types used by the operations.
 */
namespace Library.Circulation;

using {Library.Catalog} from './common';

// ---------------------------------------------------------------------------------------------
// Complex types (operation payloads)
// ---------------------------------------------------------------------------------------------

type OverdueNotice {
  Reason    : String;
  Amount    : Decimal(5, 2);
  CreatedAt : Timestamp;
}

type LoanStats {
  TotalLoans          : Int64;

  @odata.Type: 'Edm.Duration'
  AverageLoanDuration : String;
}

type BranchStats {
  BranchId  : Integer;
  LoanCount : Int64;
}

type AnnualReport {
  Year          : Integer;
  TotalLoans    : Int64;
  TotalLateFees : Decimal(12, 2);
}

type DateRange {
  /** `from` is a reserved CDL word - escaped, the OData property name stays `From`. */
  ![From] : Date;
  To      : Date;
}

// ---------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------

entity Member {
  key Id                : Integer;
      Name              : String(100) not null;
      DateOfBirth       : Date;

      /** GAP G1: flattened to Address_Street, Address_City, Address_PostalCode, Address_Country. */
      Address           : Catalog.PostalAddress;

      /** Collection of a complex type - this one *does* produce a real `<ComplexType>`. */
      PreviousAddresses : many Catalog.PostalAddress;

      ActiveSince       : Timestamp;

      /** Deliberately different facets from Loan.LateFee (Decimal 5,2). */
      Balance           : Decimal(9, 2);

      Loans             : Composition of many Loan on Loans.Member = $self;
      Reservations      : Composition of many Reservation on Reservations.Member = $self;
      IdDocument        : Association to IdDocument;
}
// Bound operations: see srv/library-service.cds.

/**
 * Composite key (MediumId + InventoryNumber) as in the reference model.
 *
 * GAP G2 consequence: `MediumId` stays a bare Guid instead of a managed association to the
 * abstract `Medium` type - CAP cannot model an association whose target is an abstract base
 * type covering all seven media entities. The media entities carry an unmanaged `Copies`
 * backlink over this column instead (see catalog.cds), so `$expand=Copies` still works.
 */
entity Copy {
  key MediumId        : UUID;
  key InventoryNumber : Integer;

      /** Reference model annotates the Copies set with Core.OptimisticConcurrency on Condition. */
      @odata.etag
      Condition       : UInt8;

      IsLoanable      : Boolean not null default true;
      Status          : Catalog.AvailabilityStatus;
      AcquisitionDate : Date;

      /** GAP: CDS has no single-precision float; metadata is overridden, storage stays double. */
      @odata.Type   : 'Edm.Single'
      WeightKg        : Double;

      /**
       * Trailing underscore deliberately collides with the `Location` navigation property under a
       * client renaming strategy (odata2ts#142).
       * GAP G12: `@odata.Unicode` is ignored by CAP - no `Unicode="false"` facet is emitted.
       */
      @odata.Unicode: false
      Location_       : String(10);

      Location        : Association to Branch;
}
// Bound operations: see srv/library-service.cds.

entity Loan {
  key Id         : UUID;
      LoanedAt   : Timestamp not null;
      DueDate     : Date not null;

      /** Deliberately nullable: explicit-`null`-vs-absent-property test case (odata2ts#257/#218). */
      ReturnedAt : Timestamp;

      LateFee    : Decimal(5, 2);
      Member     : Association to Member not null;

      /** Composite foreign key -> renders two `<ReferentialConstraint>` entries. */
      Copy       : Association to Copy not null;
}
// Bound operations: see srv/library-service.cds.

entity Reservation {
  key Id        : UUID;
      ReservedAt : Timestamp;

      /**
       * Not in the reference model - required as the backlink target of `Member.Reservations`,
       * because CAP compositions need an explicit ON condition.
       */
      Member    : Association to Member;
}

entity IdDocument {
  key Id         : UUID;

      /** `Edm.Binary`: upload via PATCH, download via `.../Scan/$value`. */
      Scan       : Binary;

      UploadedAt : Timestamp;
}

entity Branch {
  key Id              : Integer;
      Name            : String(100) not null;
      Address         : Catalog.PostalAddress;

      /** GAP: CDS has no spatial types - metadata is overridden, values are WKT strings. */
      @odata: {
        Type: 'Edm.GeographyPoint',
        SRID: 4326
      }
      Location        : String;

      @odata: {
        Type: 'Edm.GeographyPolygon',
        SRID: 4326
      }
      CatchmentArea   : String;

      /** GAP: CDS has no signed 8-bit integer. */
      @odata.Type: 'Edm.SByte'
      LowestFloor     : Int16;

      @odata: {
        Type: 'Edm.GeometryPoint',
        SRID: 0
      }
      FloorPlanOrigin : String;

      @odata: {
        Type: 'Edm.GeometryCollection',
        SRID: 0
      }
      FloorPlanShapes : String;

      OpensAt         : Time;
      ClosesAt        : Time;
      Amenities       : Catalog.Amenities;
      Population      : Int64;
}

entity Bookmobile {
  key Id              : Integer;
      LicensePlate    : String(12);

      @odata: {
        Type: 'Edm.GeographyLineString',
        SRID: 4326
      }
      Route           : String;

      @odata: {
        Type: 'Edm.GeographyPoint',
        SRID: 4326
      }
      CurrentPosition : String;
}
