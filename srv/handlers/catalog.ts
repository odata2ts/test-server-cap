import cds from "@sap/cds";
import { boundMediumId, isoDuration, MEDIA_ENTITIES, toNumber } from "./shared";

const { SELECT, INSERT } = cds.ql;

/**
 * Catalog-side operations: everything the reference model binds to `Medium` or declares unbound
 * over the media sets.
 */
export function registerCatalogHandlers(srv: cds.ApplicationService): void {
  const { Books, Copies, Loans, CollectorsItems, Reservations } = srv.entities;

  // -------------------------------------------------------------------------------------------
  // Bound to each concrete medium (reference model: bound to the abstract `Medium`)
  // -------------------------------------------------------------------------------------------

  for (const media of MEDIA_ENTITIES) {
    const entity = srv.entities[media];

    /** Returns the complex type `MediumStats`. */
    srv.on("LoanMetrics", media, async (req) => {
      const mediumId = boundMediumId(req);
      const [stats] = await SELECT.from(Loans)
        .columns("count(*) as total", "avg(julianday(DueDate) - julianday(LoanedAt)) as avgDays")
        .where({ Copy_MediumId: mediumId });

      return {
        TotalLoanCount: toNumber(stats?.total),
        AverageLoanDuration: isoDuration(toNumber(stats?.avgDays)),
      };
    });

    /** Bound to a *collection* (`in : many $self`) - returns `Collection(Edm.String)`. */
    srv.on("AvailableLanguages", media, async () => {
      const rows = await SELECT.distinct.from(entity).columns("Language").where("Language is not null");
      return rows.map((r: { Language: string }) => r.Language).sort();
    });

    /**
     * Reference model: `IsComposable="true"` with `EntitySetPath="medium/Copies"`.
     * CAP emits `IsComposable="false"` (GAP G5) but does derive the entity set path, so the
     * result is addressable - only chaining query options onto the result is unavailable.
     */
    srv.on("AvailableCopies", media, async (req) => {
      return SELECT.from(Copies).where({ MediumId: boundMediumId(req), IsLoanable: true });
    });

    srv.on("AvailableCopy", media, async (req) => {
      const [copy] = await SELECT.from(Copies)
        .where({ MediumId: boundMediumId(req), IsLoanable: true })
        .orderBy("InventoryNumber")
        .limit(1);

      if (!copy) return req.reject(404, `No loanable copy available for this ${media} entry.`);
      return copy;
    });

    /** Bound action with a primitive return type. */
    srv.on("Reserve", media, async (req) => {
      const mediumId = boundMediumId(req);
      const { MemberId } = req.data;

      const [member] = await SELECT.from(srv.entities.Members).where({ Id: MemberId });
      if (!member) return req.reject(400, `Member ${MemberId} does not exist.`);

      await INSERT.into(Reservations).entries({
        ReservedAt: new Date().toISOString(),
        Member_Id: MemberId,
      });

      const [{ open }] = await SELECT.from(Reservations).columns("count(*) as open").where({ Member_Id: MemberId });
      void mediumId;
      return toNumber(open);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Unbound
  // -------------------------------------------------------------------------------------------

  srv.on("TotalMediaCount", async () => {
    let total = 0;
    for (const media of MEDIA_ENTITIES) {
      const [row] = await SELECT.from(srv.entities[media]).columns("count(*) as n");
      total += toNumber(row?.n);
    }
    return total;
  });

  srv.on("AllLanguages", async () => {
    const languages = new Set<string>();
    for (const media of MEDIA_ENTITIES) {
      const rows = await SELECT.distinct.from(srv.entities[media]).columns("Language");
      for (const row of rows as Array<{ Language: string | null }>) {
        if (row.Language) languages.add(row.Language);
      }
    }
    return [...languages].sort();
  });

  /**
   * Reference model: returns the abstract `Medium`. Typed as `Books` here (GAP G2), so only books
   * can ever be returned - the operation cannot express "the most read medium of any kind".
   */
  srv.on("MostReadMedium", async () => {
    const [book] = await SELECT.from(Books).orderBy("PopularityScore desc").limit(1);
    return book;
  });

  srv.on("NewReleases", async () => {
    return SELECT.from(Books).orderBy("PublicationDate desc").limit(5);
  });

  srv.on("Search", async (req) => {
    const { Term, MaxResults } = req.data;
    const limit = toNumber(MaxResults) || 25;
    return SELECT.from(Books)
      .where(`Title like '%${String(Term).replace(/'/g, "''")}%'`)
      .limit(limit);
  });

  srv.on("RunStockCheck", async () => {
    // "Everything with no loanable copy left" - a plausible stock-check result.
    const books = await SELECT.from(Books);
    const result = [];
    for (const book of books as Array<{ Id: string }>) {
      const [row] = await SELECT.from(Copies).columns("count(*) as n").where({ MediumId: book.Id, IsLoanable: true });
      if (toNumber(row?.n) === 0) result.push(book);
    }
    return result;
  });

  /** Unbound action returning a single entity - and the only writer of an open type. */
  srv.on("AcquireCollectorsItem", async (req) => {
    const { Title, Description } = req.data;
    const Id = cds.utils.uuid();

    await INSERT.into(CollectorsItems).entries({
      Id,
      Title,
      ExtraData: Description ?? null,
      PopularityScore: 0,
    });

    const [created] = await SELECT.from(CollectorsItems).where({ Id });
    return created;
  });
}
