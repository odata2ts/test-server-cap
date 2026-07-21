import cds from "@sap/cds";
import { boundKey, toNumber } from "./shared";

const { SELECT, INSERT, UPDATE } = cds.ql;

/** Loan period granted by `CheckOut` / `Renew`, in days. */
const LOAN_PERIOD_DAYS = 28;

function dueDate(from: Date = new Date()): string {
  const due = new Date(from);
  due.setDate(due.getDate() + LOAN_PERIOD_DAYS);
  return due.toISOString().slice(0, 10);
}

/** Operations bound to `Copies`, `Members` and `Loans`. */
export function registerCirculationHandlers(srv: cds.ApplicationService): void {
  const { Copies, Loans, Members } = srv.entities;

  // -------------------------------------------------------------------------------------------
  // Bound to Copies
  // -------------------------------------------------------------------------------------------

  /** The no-return-type case for a bound action. */
  srv.on("CheckOut", "Copies", async (req) => {
    const key = boundKey(req);
    const { MemberId } = req.data;

    const [copy] = await SELECT.from(Copies).where(key);
    if (!copy) return req.reject(404, "Copy not found.");
    if (!copy.IsLoanable) return req.reject(409, "This copy is not loanable.");

    const [member] = await SELECT.from(Members).where({ Id: MemberId });
    if (!member) return req.reject(400, `Member ${MemberId} does not exist.`);

    await INSERT.into(Loans).entries({
      Id: cds.utils.uuid(),
      LoanedAt: new Date().toISOString(),
      DueDate: dueDate(),
      ReturnedAt: null,
      Member_Id: MemberId,
      Copy_MediumId: key.MediumId,
      Copy_InventoryNumber: key.InventoryNumber,
    });

    await UPDATE.entity(Copies).set({ IsLoanable: false, Status: 1 }).where(key);
    // No `return` - the action has no return type.
  });

  /** Bound action returning the complex type `ConditionReport`. */
  srv.on("AssessCondition", "Copies", async (req) => {
    const key = boundKey(req);
    const { NewCondition, Remark } = req.data;

    const [copy] = await SELECT.from(Copies).where(key);
    if (!copy) return req.reject(404, "Copy not found.");

    await UPDATE.entity(Copies).set({ Condition: NewCondition }).where(key);

    return {
      ConditionBefore: copy.Condition,
      ConditionAfter: NewCondition,
      Remark: Remark ?? null,
    };
  });

  // -------------------------------------------------------------------------------------------
  // Bound to Members
  // -------------------------------------------------------------------------------------------

  srv.on("OutstandingBalance", "Members", async (req) => {
    const { Id } = boundKey(req);

    const [member] = await SELECT.from(Members).where({ Id });
    if (!member) return req.reject(404, "Member not found.");

    const [fees] = await SELECT.from(Loans).columns("sum(LateFee) as total").where({ Member_Id: Id, ReturnedAt: null });

    return toNumber(member.Balance) + toNumber(fees?.total);
  });

  /** Returns `Collection(OverdueNotice)` - a collection of a complex type. */
  srv.on("NoticeHistory", "Members", async (req) => {
    const { Id } = boundKey(req);
    return overdueNoticesFor(Id as number);
  });

  /** Same payload as an action rather than a function. */
  srv.on("RunReminders", "Members", async (req) => {
    const { Id } = boundKey(req);
    return overdueNoticesFor(Id as number);
  });

  async function overdueNoticesFor(memberId: number) {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = await SELECT.from(Loans)
      .where({ Member_Id: memberId, ReturnedAt: null })
      .and(`DueDate < '${today}'`);

    return (overdue as Array<{ DueDate: string; LateFee: number | null }>).map((loan) => ({
      Reason: `Loan overdue since ${loan.DueDate}`,
      Amount: toNumber(loan.LateFee),
      CreatedAt: new Date().toISOString(),
    }));
  }

  // -------------------------------------------------------------------------------------------
  // Bound to Loans
  // -------------------------------------------------------------------------------------------

  /** Entity-returning bound action; CAP emits `EntitySetPath="in"` for it. */
  srv.on("Renew", "Loans", async (req) => {
    const key = boundKey(req);

    const [loan] = await SELECT.from(Loans).where(key);
    if (!loan) return req.reject(404, "Loan not found.");
    if (loan.ReturnedAt) return req.reject(409, "This loan has already been returned.");

    await UPDATE.entity(Loans).set({ DueDate: dueDate() }).where(key);

    const [renewed] = await SELECT.from(Loans).where(key);
    return renewed;
  });

  /** Bound to a *collection* and returning a collection of entities. */
  srv.on("RenewAll", "Loans", async () => {
    const open = await SELECT.from(Loans).where({ ReturnedAt: null });
    const newDueDate = dueDate();

    for (const loan of open as Array<{ Id: string }>) {
      await UPDATE.entity(Loans).set({ DueDate: newDueDate }).where({ Id: loan.Id });
    }

    return SELECT.from(Loans).where({ ReturnedAt: null });
  });

  /** Bound to a collection, returning `Collection(Edm.String)`. */
  srv.on("BulkRenew", "Loans", async () => {
    const open = await SELECT.from(Loans).where({ ReturnedAt: null });
    const newDueDate = dueDate();

    const messages: string[] = [];
    for (const loan of open as Array<{ Id: string }>) {
      await UPDATE.entity(Loans).set({ DueDate: newDueDate }).where({ Id: loan.Id });
      messages.push(`Loan ${loan.Id} renewed until ${newDueDate}`);
    }
    return messages;
  });
}
