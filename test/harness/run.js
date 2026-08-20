"use strict";

/**
 * Runs the request collection against the container image, one fresh container per file.
 *
 * The collections assume the freshly seeded state and are written to run top to bottom: they patch and
 * delete seed rows, and `Members` keys are assigned server-side as max + 1, so a single POST shifts the
 * keys a later request addresses by hand. Running the V4 and V2 collections against one container would
 * make each depend on what the other had already written, so each file gets its own - which is also this
 * server's only reset, and by design: a restart redeploys the seed data from db/data/*.csv.
 *
 * Measured at roughly four seconds a container locally, which is not what this run spends its time on.
 *
 * Both collections run against the same container: `requests-v2.http` addresses `/odata/v2/library`,
 * which the `@cap-js-community/odata-v2-adapter` plugin serves from the same process as the V4 endpoint.
 * Only the readiness probe names a path, and V4 answering means the process is up.
 *
 *   IMAGE   image to run          (default test-server-cap:local)
 *   PORT    port to publish on    (default 4004, the port @host names in the files)
 */

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { collectionFiles } = require("./requests");

const ROOT = path.join(__dirname, "..", "..");
const IMAGE = process.env.IMAGE || "test-server-cap:local";
const PORT = Number(process.env.PORT || 4004);
const CONTAINER = "cap-http-test";
const READY_TIMEOUT_MS = 90_000;

function docker(args, options = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...options });
}

function removeContainer() {
  docker(["rm", "-f", CONTAINER], { stdio: "ignore" });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls the service document rather than the container's health status, which only reports every 5s. */
async function waitUntilServing(url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      // not listening yet
    }
    await sleep(200);
  }

  const logs = docker(["logs", "--tail", "40", CONTAINER]);
  throw new Error(`${IMAGE} did not answer on ${url} within ${READY_TIMEOUT_MS / 1000}s\n${logs.stdout}${logs.stderr}`);
}

/**
 * Reports one file's run.
 *
 * httpyac's own summary counts regions rather than requests - the `###` lines that separate the paragraphs
 * of a longer note open a region of their own - so the numbers worth reading are taken from the JSON
 * instead, and a failure is printed with the exchange that produced it.
 *
 * @returns {boolean} whether every test in the file passed
 */
function report(output) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    console.log(output.trim());
    return false;
  }

  const requests = result.requests.filter((request) => request.testResults?.length > 0);
  const { totalTests, failedTests, erroredTests } = result.summary;

  for (const request of requests) {
    for (const test of request.testResults.filter((test) => test.status !== "SUCCESS")) {
      const response = request.response;

      console.log(`\n  ✖ ${test.message}`);
      console.log(`    ${test.error?.displayMessage ?? test.status}`);
      if (response) {
        console.log(`    ${response.request?.method} ${response.request?.url}`);
        console.log(`    ${response.statusCode} ${response.statusMessage ?? ""}`.trimEnd());
        if (response.body) {
          console.log(`    ${String(response.body).slice(0, 500)}`);
        }
      }
    }
  }

  const failures = failedTests + erroredTests;
  const summary = `${requests.length} requests, ${totalTests} assertions`;
  console.log(failures > 0 ? `\n  ${summary}, ${failures} failed` : `  ${summary}, all passed`);

  return failures === 0;
}

/** One file, against a container of its own. Resolves to true when every request in it passed. */
async function runFile(file, serviceUrl) {
  removeContainer();

  const started = docker(["run", "-d", "--name", CONTAINER, "-p", `${PORT}:4004`, IMAGE]);
  if (started.status !== 0) {
    throw new Error(`could not start ${IMAGE}: ${started.stderr.trim()}`);
  }

  try {
    await waitUntilServing(serviceUrl);

    // Into a file rather than through a pipe. httpyac ends with process.exit(), and a Node write to a
    // pipe is asynchronous - so the tail of a large report is simply lost, which looks exactly like a
    // failing file because the JSON no longer parses. Writes to a file descriptor are synchronous.
    const reportFile = path.join(os.tmpdir(), `httpyac-${process.pid}-${path.basename(file)}.json`);
    const handle = fs.openSync(reportFile, "w");

    const output = await new Promise((resolve, reject) => {
      const httpyac = spawn(
        process.execPath,
        [require.resolve("httpyac/bin/httpyac.js"), "send", "--all", "--json", path.relative(ROOT, file)],
        { cwd: ROOT, stdio: ["ignore", handle, "inherit"] },
      );

      httpyac.on("error", reject);
      httpyac.on("close", () => {
        fs.closeSync(handle);
        resolve(fs.readFileSync(reportFile, "utf8"));
      });
    }).finally(() => fs.rmSync(reportFile, { force: true }));

    return report(output);
  } finally {
    removeContainer();
  }
}

async function main() {
  const requested = process.argv.slice(2);
  const files = requested.length > 0 ? requested.map((file) => path.resolve(file)) : collectionFiles();
  const serviceUrl = `http://localhost:${PORT}/odata/v4/library/`;

  if (docker(["version"], { stdio: "ignore" }).status !== 0) {
    console.error("docker is not available - the collection runs against the container image.");
    process.exitCode = 1;
    return;
  }

  if (docker(["image", "inspect", IMAGE], { stdio: "ignore" }).status !== 0) {
    console.error(`no image ${IMAGE}. Build it first:\n\n    docker build -t ${IMAGE} .\n`);
    process.exitCode = 1;
    return;
  }

  process.on("SIGINT", () => {
    removeContainer();
    process.exit(130);
  });

  console.log(`${files.length} file(s) against ${IMAGE}, a fresh container each, on port ${PORT}\n`);

  const failed = [];
  for (const file of files) {
    const name = path.basename(file);
    console.log(`── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`);

    if (!(await runFile(file, serviceUrl))) {
      failed.push(name);
    }
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} of ${files.length} file(s) failed: ${failed.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${files.length} file(s) passed.`);
}

main().catch((error) => {
  removeContainer();
  console.error(error.message);
  process.exitCode = 1;
});
