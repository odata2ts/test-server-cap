import cds from "@sap/cds";
import { registerAdminHandlers } from "./handlers/admin";
import { registerCatalogHandlers } from "./handlers/catalog";
import { registerCirculationHandlers } from "./handlers/circulation";
import { registerKeyHandlers } from "./handlers/keys";

/**
 * Implementation of `Library.Service` (srv/library-service.cds).
 *
 * The handlers are deliberately thin: their job is to prove that each operation of the reference
 * model is *callable* and returns a payload of the declared shape - not to be a real library
 * backend. Where an operation cannot behave as the reference model specifies because of a CAP
 * limitation, the handler is kept and the deviation is documented in FEATURE-COVERAGE.md.
 */
export default class LibraryService extends cds.ApplicationService {
  async init(): Promise<void> {
    registerKeyHandlers(this);
    registerCatalogHandlers(this);
    registerCirculationHandlers(this);
    registerAdminHandlers(this);

    return super.init();
  }
}
