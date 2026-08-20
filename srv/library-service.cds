/**
 * Service definition of the "Library" OData V4 test model.
 *
 * The CDS name `Library.Service` is chosen so that the emitted EDM schema namespace matches the
 * container namespace of the reference model (`Library.Service`).
 *
 * CAP renders exactly one EDM schema per service, so the four namespaces of the reference model
 * (`Library.Catalog`, `Library.Circulation`, `PublisherRegistry`, `Library.Service`) all collapse
 * into this one - which is also why `PublisherRegistry.Branch` had to be renamed (see
 * db/publishers.cds). FEATURE-COVERAGE.md §1.4.
 *
 * All bound operations are declared here rather than next to their entities in db/: `as projection
 * on` does not carry `actions {}` blocks from the db layer into the service, and entity-returning
 * operations must reference a service entity in any case.
 */
namespace Library;

using {Library.Catalog} from '../db/catalog';
using {Library.Circulation} from '../db/circulation';
using {PublisherRegistry} from '../db/publishers';

service Service @(path: '/odata/v4/library') {

  // -------------------------------------------------------------------------------------------
  // Media
  //
  // Reference model: a single entity set `Media` over the abstract `Medium`, with all media-bound
  // operations declared once against that base type. CDS models hierarchies with aspects rather
  // than inheritance, so this is table-per-leaf-class: one entity set per concrete type, and the
  // bound operations repeated per type. See db/catalog.cds and FEATURE-COVERAGE.md §1.1.
  // -------------------------------------------------------------------------------------------

  /**
   * `@Core.AlternateKeys` renders correctly into `$metadata`, but CAP's runtime does **not**
   * resolve alternate-key addressing: `Books(ISBN='...')` fails. Kept deliberately so the
   * discrepancy between metadata promise and runtime behaviour stays observable - §4.2.
   */
  @Capabilities.SearchRestrictions.Searchable: true
  @Core.AlternateKeys                        : [{Key: [{Name: ISBN}]}]
  @cds.redirection.target
  entity Books             as projection on Catalog.Book actions {
                              function LoanMetrics()                       returns Catalog.MediumStats;
                              function AvailableLanguages(in : many $self) returns array of String;

                              /**
                               * `IsComposable="true"` in the reference model, always `false` in
                               * CAP (§4.1). `EntitySetPath` is derived automatically, though.
                               */
                              function AvailableCopies()                   returns array of Copies;

                              function AvailableCopy()                     returns Copies;
                              action   Reserve(MemberId : Integer)         returns Integer;
                            };

  @Capabilities.SearchRestrictions.Searchable: true
  @Core.AlternateKeys                        : [{Key: [{Name: ISBN}]}]
  entity Magazines         as projection on Catalog.Magazine actions {
                              function LoanMetrics()                       returns Catalog.MediumStats;
                              function AvailableLanguages(in : many $self) returns array of String;
                              function AvailableCopies()                   returns array of Copies;
                              function AvailableCopy()                     returns Copies;
                              action   Reserve(MemberId : Integer)         returns Integer;
                            };

  @Capabilities.SearchRestrictions.Searchable: true
  @Core.AlternateKeys                        : [{Key: [{Name: ISBN}]}]
  entity TradeJournals     as projection on Catalog.TradeJournal actions {
                              function LoanMetrics()                       returns Catalog.MediumStats;
                              function AvailableLanguages(in : many $self) returns array of String;
                              function AvailableCopies()                   returns array of Copies;
                              function AvailableCopy()                     returns Copies;
                              action   Reserve(MemberId : Integer)         returns Integer;
                            };

  @Capabilities.SearchRestrictions.Searchable: true
  entity Audiobooks        as projection on Catalog.Audiobook actions {
                              function LoanMetrics()                       returns Catalog.MediumStats;
                              function AvailableLanguages(in : many $self) returns array of String;
                              function AvailableCopies()                   returns array of Copies;
                              function AvailableCopy()                     returns Copies;
                              action   Reserve(MemberId : Integer)         returns Integer;
                            };

  /**
   * Reference model: reachable only via containment from `Audiobook`, with no entity set of its own -
   * which is what `@odata.contained` on `Audiobook.Chapters` achieves. The projection stays: it names
   * the type the containment navigation property points at, and the V2 rendition still needs an entity
   * set, V2 having no containment to express. See FEATURE-COVERAGE.md §1.2.
   */
  entity AudiobookChapters as projection on Catalog.AudiobookChapter;

  @Capabilities.SearchRestrictions.Searchable: true
  entity DVDs              as projection on Catalog.DVD actions {
                              function LoanMetrics()                       returns Catalog.MediumStats;
                              function AvailableLanguages(in : many $self) returns array of String;
                              function AvailableCopies()                   returns array of Copies;
                              function AvailableCopy()                     returns Copies;
                              action   Reserve(MemberId : Integer)         returns Integer;
                            };

  @Capabilities.SearchRestrictions.Searchable: true
  entity EBooks            as projection on Catalog.EBook actions {
                              function LoanMetrics()                       returns Catalog.MediumStats;
                              function AvailableLanguages(in : many $self) returns array of String;
                              function AvailableCopies()                   returns array of Copies;
                              function AvailableCopy()                     returns Copies;
                              action   Reserve(MemberId : Integer)         returns Integer;
                            };

  @Capabilities.SearchRestrictions.Searchable: true
  entity CollectorsItems   as projection on Catalog.CollectorsItem actions {
                              function LoanMetrics()                       returns Catalog.MediumStats;
                              function AvailableLanguages(in : many $self) returns array of String;
                              function AvailableCopies()                   returns array of Copies;
                              function AvailableCopy()                     returns Copies;
                              action   Reserve(MemberId : Integer)         returns Integer;
                            };

  // -------------------------------------------------------------------------------------------
  // Circulation
  // -------------------------------------------------------------------------------------------

  /**
   * `Copy.Condition` carries `@odata.etag`, so this set participates in optimistic concurrency
   * (If-Match / 412), and does so correctly. Note only that CAP emits `Core.OptimisticConcurrency`
   * with an *empty* collection instead of naming `Condition` - see FEATURE-COVERAGE.md §2.5.
   */
  entity Copies            as projection on Circulation.Copy actions {
                              /** The no-return-type case for a *bound* action. */
                              action CheckOut(MemberId : Integer);

                              action AssessCondition(
                                       NewCondition : UInt8,
                                       Remark : String
                                     ) returns Catalog.ConditionReport;
                            };

  @cds.redirection.target
  entity Members           as projection on Circulation.Member actions {
                              function OutstandingBalance() returns Decimal(9, 2);
                              function NoticeHistory()      returns array of Circulation.OverdueNotice;
                              action   RunReminders()       returns array of Circulation.OverdueNotice;
                            };

  @cds.redirection.target
  entity Loans             as projection on Circulation.Loan actions {
                              /** CAP derives `EntitySetPath="in"` for these automatically. */
                              action Renew()                    returns Loans;

                              action RenewAll(in : many $self)  returns array of Loans;
                              action BulkRenew(in : many $self) returns array of String;
                            };

  entity Reservations      as projection on Circulation.Reservation;
  entity IdDocuments       as projection on Circulation.IdDocument;

  @cds.redirection.target
  entity Branches          as projection on Circulation.Branch;

  entity Bookmobiles       as projection on Circulation.Bookmobile;

  /** Reference model: `<Singleton Name="MainBranch" Type="Library.Circulation.Branch"/>`. */
  @odata.singleton
  entity MainBranch        as projection on Circulation.Branch;

  // -------------------------------------------------------------------------------------------
  // Publisher registry
  // -------------------------------------------------------------------------------------------

  entity Publishers        as projection on PublisherRegistry.Publisher;
  entity PublisherBranches as projection on PublisherRegistry.PublisherBranch;

  // -------------------------------------------------------------------------------------------
  // Unbound functions
  // -------------------------------------------------------------------------------------------

  function TotalMediaCount()                              returns Int64;
  function AllLanguages()                                 returns array of String;

  /** Complex parameter - exercises `@p1` parameter aliasing (odata2ts#285/#291). */
  function LoanStatistics(Period : Circulation.DateRange) returns Circulation.LoanStats;

  function StatsPerBranch()                               returns array of Circulation.BranchStats;

  /**
   * Reference model: returns the abstract `Medium`. With no abstract type to return, this is typed
   * as `Books` - the representative concrete type. FEATURE-COVERAGE.md §1.1.
   */
  function MostReadMedium()                               returns Books;

  /** FEATURE-COVERAGE.md §4.1: `IsComposable="true"` in the reference model, always `false` in CAP. */
  function NewReleases()                                  returns array of Books;

  /**
   * FEATURE-COVERAGE.md §4.1: the reference model declares *two* overloads (`Term`, and `Term` + `MaxResults`).
   * CDS cannot declare the same operation name twice, so only the richer signature exists;
   * `MaxResults` is optional at runtime.
   */
  function Search(Term : String not null, MaxResults : Integer) returns array of Books;

  // -------------------------------------------------------------------------------------------
  // Unbound actions
  // -------------------------------------------------------------------------------------------

  /** The no-return-type case - only actions may omit `returns`. */
  action ClosureDay(Day : Date not null);

  action NextInventoryNumber()                              returns Integer;

  /** Collection parameter (odata2ts#72). */
  action CleanUpKeywords(Obsolete : array of String)        returns array of String;

  action YearEndClosing(Year : Integer not null)            returns Circulation.AnnualReport;
  action RunOverdueNotices()                                returns array of Circulation.OverdueNotice;

  action AcquireCollectorsItem(
           Title : String not null,
           Description : String
         )                                                  returns CollectorsItems;

  action RunStockCheck()                                    returns array of Books;
}
