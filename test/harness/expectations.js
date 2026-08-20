"use strict";

/**
 * Curated response-body assertions.
 *
 * The status code of every request is asserted from its `### <status>` annotation - see requests.js. That
 * catches a route that stops binding, a 400 that turns into a 500, a workaround that quietly stopped
 * working. It does not catch a payload that changes shape while still answering 200, so the handful of
 * responses whose *content* is the point are pinned here.
 *
 * Deliberately not a snapshot of every response: server-assigned keys, ETags and result order would all
 * need scrubbing rules before a golden file recorded anything. These are picked for being stable by
 * construction - scalars, counts, and round-trips that read back what the preceding request wrote.
 *
 * Keys are the request line as written in the file. `nth` picks one of several identical lines, counting
 * from 1 in file order; lint.js insists on it wherever the line is not unique, so an assertion can never
 * silently move to a different request.
 *
 * Each assertion gets `{ body, text, response, assert }`: `body` is the parsed JSON (undefined when the
 * response is not JSON), `text` the raw body, `assert` node's strict assert.
 */

module.exports = {
  "requests.http": [
    {
      request: "GET {{host}}/$metadata",
      // The comparison artifact of the whole repo. A status code says nothing about whether the model
      // still declares the entity types a generated client is built from.
      assert: ({ text, assert }) => {
        assert.match(text, /<Schema Namespace="Library\.Service"/, "the service schema is missing");
        for (const type of ["Books", "Members", "Copies", "Audiobooks"]) {
          assert.match(text, new RegExp(`<EntitySet Name="${type}"`), `entity set ${type} is missing`);
        }
      },
    },
    {
      request: "GET {{host}}/Members?$filter=Name eq 'Composition Deep Insert'&$expand=IdDocument",
      // The positive half of the composition/association pair. Reading the parent back is the only way
      // to tell a created child from one the response merely echoed.
      assert: ({ body, assert }) => {
        assert.equal(body.value.length, 1, "the member created by the deep insert is not there");
        assert.ok(body.value[0].IdDocument, "the composition target was not created with its parent");
      },
    },
    {
      request: "GET {{host}}/Books?$filter=Title eq 'Association Deep Insert Many'&$expand=Copies",
      // The point of the negative half: the POST answered 201, so only the body shows that nothing was
      // written. If CAP ever starts honouring a nested array on an association, this fails and the
      // annotation above it has to be rewritten - which is exactly when we want to hear about it.
      assert: ({ body, assert }) => {
        assert.equal(body.value.length, 1, "the book itself was not created");
        assert.deepEqual(body.value[0].Copies, [], "the nested array on an association was written after all");
      },
    },
  ],
};
