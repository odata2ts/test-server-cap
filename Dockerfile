# syntax=docker/dockerfile:1

# Runnable image of the "Library" OData V4 test server.
#
# Consumers start this image, point their client at http://<host>:<port>/odata/v4/library and get a
# server with fixed, well-known seed data - see odata2ts/odata2ts, int-test/cap.

FROM node:24-slim

# `cds serve` needs the dev dependencies (`@sap/cds-dk`, `tsx`), so NODE_ENV must not be "production":
# npm would skip them and the service implementation would not load.
ENV NODE_ENV=development

WORKDIR /app

# Dependencies first: a change to the model or the handlers must not invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Bake the SQLite database, including the seed data from db/data/*.csv, into the image. Every container
# therefore starts from the identical, well-known state - which is what integration tests assert
# against - and needs no deploy step at startup.
RUN npx cds deploy

EXPOSE 4004

HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:4004/odata/v4/library/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# `cds serve` from @sap/cds-dk - deliberately not the `cds-serve` binary of @sap/cds. Only the former
# loads the TypeScript service implementation; with `cds-serve` the generic CRUD surface works but every
# custom operation answers 501 "has no handler", even with tsx registered as a loader.
CMD ["npx", "cds", "serve", "--port", "4004"]
