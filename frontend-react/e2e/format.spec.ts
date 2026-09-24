import { expect, test } from "@playwright/test";
import { compareAccountNames } from "../src/lib/format";

// Node-only: no page, so it runs before the preview server matters.
test("имена учёток сортируются по номеру, а не посимвольно", () => {
  const names = ["g16.geodezia", "g2.geodezia", "g24.geodezia", "g1.geodezia", "u10.geodezia", "u2.geodezia"];
  expect([...names].sort(compareAccountNames)).toEqual([
    "g1.geodezia",
    "g2.geodezia",
    "g16.geodezia",
    "g24.geodezia",
    "u2.geodezia",
    "u10.geodezia",
  ]);
});
