import cds from "@sap/cds";

const { SELECT } = cds.ql;

/**
 * Entity sets whose key is a single `Integer` element. The reference model declares these keys plain - no
 * `Core.Computed`, no generation strategy - so nothing fills them in on the way through CAP. This handler
 * does, and each of those keys carries `Core.ComputedDefaultValue` to say so on the wire: the client may
 * supply a value, the server generates one otherwise. CAP states the term for a `UUID` key by itself and
 * for an `Integer` key not at all, so without it a client has to treat the key as one it must invent.
 */
const INTEGER_KEYED_ENTITIES = [
  "Members",
  "Branches",
  "Bookmobiles",
  "Publishers",
  "PublisherBranches",
  "AudiobookChapters",
] as const;

/**
 * Fills in the key of an entity keyed by a single `Integer`, unless the request brings one.
 *
 * Without this, a create that omits the key answers **201 with an entirely different entity**: the row
 * is written - SQLite treats `PRIMARY KEY(Id)` on an `INTEGER` column as an alias for the rowid and
 * assigns the next one silently - but CAP never learns that value, so it reads the result back with no
 * key at hand and returns the first row of the set instead. The client then holds a payload describing
 * a row it did not create, with no way to address the one it did.
 *
 * The ASP.NET implementation of the same model generates these keys, so generating them here keeps the
 * two servers comparable, which is what the integration tests on both sides depend on.
 *
 * `max + 1` is good enough for a test server driven by one client at a time; it is not safe under
 * concurrent creates, and it is deliberately not presented as if it were.
 */
export function registerKeyHandlers(srv: cds.ApplicationService): void {
  for (const name of INTEGER_KEYED_ENTITIES) {
    const entity = srv.entities[name];
    if (!entity) continue;

    srv.before("CREATE", entity, async (req) => {
      const data = req.data as { Id?: number };
      if (data.Id !== undefined && data.Id !== null) {
        return;
      }

      const [row] = await SELECT.from(entity).columns("max(Id) as maxId");
      data.Id = Number((row as { maxId?: number } | undefined)?.maxId ?? 0) + 1;
    });
  }
}
