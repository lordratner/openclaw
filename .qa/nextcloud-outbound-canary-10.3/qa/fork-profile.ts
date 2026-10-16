// Fork-only proof config; never mutate the release's canonical routing lists.
import { createScopedVitestConfig } from "../../../../test/vitest/vitest.scoped-config.ts";

export default createScopedVitestConfig(
  [
    "extensions/nextcloud-talk/src/inbound.behavior.test.ts",
    "extensions/nextcloud-talk/src/inbound.authz.test.ts",
    "extensions/nextcloud-talk/src/inbound.room-info-retry.test.ts",
    "extensions/nextcloud-talk/src/webhook-spool.test.ts",
  ],
  {
    dir: "extensions",
    env: process.env,
    name: "extension-database-workers",
    pool: "forks",
    isolate: true,
    passWithNoTests: false,
    setupFiles: ["test/setup.extensions.ts"],
  },
);
