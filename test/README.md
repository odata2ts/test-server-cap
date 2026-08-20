# Request collection

Every scenario the service is meant to answer, as `.http` scripts, each request annotated with the status
code and behaviour **actually observed** against the running server. They are the executable counterpart
to [`FEATURE-COVERAGE.md`](../FEATURE-COVERAGE.md) and
[`FEATURE-COVERAGE-V2.md`](../FEATURE-COVERAGE-V2.md), which carry the reasoning.

Run them with any `.http` client (VS Code REST Client, IntelliJ HTTP Client, `httpyac`). Start the
service first:

```bash
npm run deploy && npm start
```

## Running the whole collection

CI runs it on every pull request, and so can you - against the image, which is what consumers pull:

```bash
docker build -t test-server-cap:local . && npm ci && npm test
```

One file at a time, once the image is built:

```bash
node test/harness/run.js test/requests-v2.http
```

The harness is in [`harness/`](harness) and asserts what the files already state: the status code on the
first line of each `### ` block. Nothing runner-specific is written into the `.http` files - they stay
plain, and the annotation stays the one statement of the expected result. A handful of responses whose
_content_ is the point are pinned in [`harness/expectations.js`](harness/expectations.js) on top of that.

Every file gets a fresh container, because the collections write to the same seed rows and integer keys
are assigned as max + 1, so one file's inserts shift the keys another addresses by hand.
`npm run lint:requests` checks the annotations alone, without a server.

| File                                   | Contents                                                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`requests.http`](requests.http)       | The OData **V4** service: service document, `$metadata`, reads, query options, CRUD, deep insert, operations, `$batch`, and the known limitations                                   |
| [`requests-v2.http`](requests-v2.http) | The OData **V2** endpoint the `@cap-js-community/odata-v2-adapter` plugin serves from the same process - payload shape, type renderings and the query options V2 spells differently |

[`batch-multipart.txt`](batch-multipart.txt) is the body of the multipart `$batch` request, kept
separate and imported with `<@`. HTTP multipart requires CRLF line endings - with LF the server answers
`400 HPE_INVALID_VERSION`, correctly - and `.http` clients normalise line endings while parsing, so the
only way to send it verbatim is from a file. `.gitattributes` exempts it from the repository's LF
normalisation; without that exemption a checkout would turn it into a failing test.

## Composition vs Association

Worth knowing before reading the deep-insert section of `requests.http`: CDS distinguishes the two, and
only a **Composition** is a containment relationship whose target is created together with its parent. An
**Association** is a reference - the nested object names an entity that has to exist already.

`$metadata` does not make the distinction visible, so the collection states it instead. Four cases are
pinned, because they answer differently and one of them answers _misleadingly_:

| Nested payload on …                                               | Result                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| a Composition (`Member.IdDocument`, `Audiobook.Chapters`)         | `201`, the target is created                         |
| an Association to one, with a non-key property (`Book.Publisher`) | `400` - only key properties are read there           |
| an Association to one, key only                                   | `201`, linked rather than created                    |
| an Association to many (`Book.Copies`)                            | `201` - and the nested array is **silently dropped** |

The last one is why the collection reads the parent back afterwards: the status code alone says the write
succeeded, and only the body shows that nothing was written.
