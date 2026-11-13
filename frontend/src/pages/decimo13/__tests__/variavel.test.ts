import { describe, expect, test } from "vitest";
import { lerValorBr } from "../variavel";

describe("lerValorBr", () => {
  test.each([
    ["638,16", 638.16], ["R$ 638,16", 638.16], ["1.234,50", 1234.5], ["638.16", 638.16], ["0", 0], ["438", 438],
  ])("lê %s", (t, n) => expect(lerValorBr(t)).toBe(n));
  test.each([[""], ["abc"], ["-5"], ["1,234,5"], ["12,345"], ["2000000"]])("recusa %s", (t) => expect(lerValorBr(t)).toBeNull());
});
