// Golden verification: logs written by the upstream C++ encoder (random
// events from the upstream EventGenerator), and legacy-format logs written
// with the protobuf API, must parse to exactly what the upstream C++ parser
// sees. Regenerate with tools/cpp-golden/build.sh.

import {readdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {
  ParsedRtcEventLog,
  UnconfiguredHeaderExtensions,
} from "../../../src/logging/rtc-event-log/rtc-event-log-parser.js";
import {dump} from "./golden-dump.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "golden");
const seeds = readdirSync(dir)
  .filter((f) => f.endsWith(".rtc"))
  .map((f) => f.replace(/\.rtc$/, ""))
  .sort();

describe("Golden logs from the upstream C++ encoder and parser", () => {
  test("there are golden logs", () => {
    expect(seeds.length).toBeGreaterThan(0);
  });

  test.each(seeds)("%s", (seed) => {
    // legacy-default-map-*: parsed with the default header extension map for
    // streams without a logged configuration.
    const log = new ParsedRtcEventLog(
      seed.startsWith("legacy-default-map-")
        ? UnconfiguredHeaderExtensions.kAttemptWebrtcDefaultConfig
        : UnconfiguredHeaderExtensions.kDontParse,
    );
    const status = log.parseString(new Uint8Array(readFileSync(join(dir, `${seed}.rtc`))));
    expect(status.message()).toBe("");
    const expected = JSON.parse(readFileSync(join(dir, `${seed}.json`), "utf8"));
    const actual = dump(log) as Record<string, unknown>;
    // Compare section by section for readable failures.
    expect(Object.keys(actual)).toEqual(Object.keys(expected));
    for (const key of Object.keys(expected)) {
      expect({[key]: actual[key]}).toEqual({[key]: expected[key]});
    }
  });
});
