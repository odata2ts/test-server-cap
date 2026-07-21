import cds from "@sap/cds";
import { isoDuration, toNumber } from "./shared";

const { SELECT } = cds.ql;

/** Unbound administrative operations: statistics, housekeeping, closing. */
export function registerAdminHandlers(srv: cds.ApplicationService): void {
  const { Loans, Copies, Branches } = srv.entities;

  /**
   * Takes a complex-typed parameter (`DateRange`) and returns a complex type (`LoanStats`).
   * Exercises `@p1` parameter aliasing on the client side (odata2ts#285/#291).
   *
   * Note: the reference model names the range bounds `From`/`To`. `from` is a reserved CDL word,
   * so the element is escaped as `![From]` - the OData property name is unaffected.
   */
  srv.on("LoanStatistics", async (req) => {
    const period = (req.data.Period ?? {}) as { From?: string; To?: string };

    let query = SELECT.from(Loans).columns(
      "count(*) as total",
      "avg(julianday(DueDate) - julianday(LoanedAt)) as avgDays",
    );
    if (period.From) query = query.where(`LoanedAt >= '${period.From}'`);
    if (period.To) query = query.and(`LoanedAt <= '${period.To}'`);

    const [stats] = await query;
    return {
      TotalLoans: toNumber(stats?.total),
      AverageLoanDuration: isoDuration(toNumber(stats?.avgDays)),
    };
  });

  /**
   * Returns a collection of a complex type.
   *
   * Counting is done in JS rather than with a correlated subquery: the loan -> copy -> branch hop
   * spans a composite foreign key, and CQL subqueries address CDS entities, not SQL table names.
   */
  srv.on("StatsPerBranch", async () => {
    const branches = (await SELECT.from(Branches).columns("Id")) as Array<{ Id: number }>;
    const copies = (await SELECT.from(Copies).columns("MediumId", "InventoryNumber", "Location_Id")) as Array<{
      MediumId: string;
      InventoryNumber: number;
      Location_Id: number | null;
    }>;
    const loans = (await SELECT.from(Loans).columns("Copy_MediumId", "Copy_InventoryNumber")) as Array<{
      Copy_MediumId: string;
      Copy_InventoryNumber: number;
    }>;

    const branchOfCopy = new Map(copies.map((c) => [`${c.MediumId}|${c.InventoryNumber}`, c.Location_Id]));

    const counts = new Map<number, number>(branches.map((b) => [b.Id, 0]));
    for (const loan of loans) {
      const branchId = branchOfCopy.get(`${loan.Copy_MediumId}|${loan.Copy_InventoryNumber}`);
      if (branchId != null && counts.has(branchId)) counts.set(branchId, counts.get(branchId)! + 1);
    }

    return branches.map((b) => ({ BranchId: b.Id, LoanCount: counts.get(b.Id) ?? 0 }));
  });

  /** The no-return-type case for an unbound action. */
  srv.on("ClosureDay", async (req) => {
    const { Day } = req.data;
    if (!Day) return req.reject(400, "A closure date is required.");
    // A real implementation would push due dates past the closure day; recording it is enough here.
    req.info(`Closure day ${Day} registered.`);
  });

  srv.on("NextInventoryNumber", async () => {
    const [row] = await SELECT.from(Copies).columns("max(InventoryNumber) as max");
    return toNumber(row?.max) + 1;
  });

  /** Collection parameter in, collection of primitives out (odata2ts#72). */
  srv.on("CleanUpKeywords", async (req) => {
    const obsolete = new Set<string>((req.data.Obsolete ?? []) as string[]);
    if (obsolete.size === 0) return [];

    const removed = new Set<string>();
    for (const media of ["Books", "Magazines", "TradeJournals", "Audiobooks", "DVDs", "EBooks", "CollectorsItems"]) {
      const rows = await SELECT.from(srv.entities[media]).columns("Id", "Keywords");
      for (const row of rows as Array<{ Keywords: string[] | null }>) {
        for (const keyword of row.Keywords ?? []) {
          if (obsolete.has(keyword)) removed.add(keyword);
        }
      }
    }
    return [...removed].sort();
  });

  /** Returns the complex type `AnnualReport`. */
  srv.on("YearEndClosing", async (req) => {
    const { Year } = req.data;
    const [row] = await SELECT.from(Loans)
      .columns("count(*) as total", "sum(LateFee) as fees")
      .where(`LoanedAt >= '${Year}-01-01' and LoanedAt <= '${Year}-12-31T23:59:59Z'`);

    return {
      Year,
      TotalLoans: toNumber(row?.total),
      TotalLateFees: toNumber(row?.fees),
    };
  });

  /** Returns a collection of a complex type. */
  srv.on("RunOverdueNotices", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = await SELECT.from(Loans).where({ ReturnedAt: null }).and(`DueDate < '${today}'`);

    return (overdue as Array<{ Id: string; DueDate: string; LateFee: number | null }>).map((loan) => ({
      Reason: `Loan ${loan.Id} overdue since ${loan.DueDate}`,
      Amount: toNumber(loan.LateFee),
      CreatedAt: new Date().toISOString(),
    }));
  });
}
