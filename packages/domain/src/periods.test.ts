import { describe, expect, it } from "vitest";
import { DomainError } from "./errors.js";
import { assertPeriodOpen, type Period } from "./periods.js";

const march: Period = {
  startsOn: "2027-03-01",
  endsOn: "2027-03-31",
  closed: true,
};
const april: Period = {
  startsOn: "2027-04-01",
  endsOn: "2027-04-30",
  closed: false,
};

function refusal(action: () => unknown): DomainError | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  return undefined;
}

describe("assertPeriodOpen", () => {
  it("lets through a date with no period: a construction is settled once, at the end", () => {
    expect(refusal(() => assertPeriodOpen("2027-03-15", []))).toBeUndefined();
  });

  it("lets through a date in an open period", () => {
    expect(
      refusal(() => assertPeriodOpen("2027-04-15", [march, april])),
    ).toBeUndefined();
  });

  it("refuses a date in a closed period, first and last days included", () => {
    for (const day of ["2027-03-01", "2027-03-15", "2027-03-31"]) {
      const error = refusal(() => assertPeriodOpen(day, [march, april]));
      expect(error?.code).toBe("period-closed");
      expect(error?.message).toContain(day);
    }
  });

  it("lets through the days just outside a closed period", () => {
    const closedApril = { ...april, closed: true };
    expect(
      refusal(() => assertPeriodOpen("2027-02-28", [march])),
    ).toBeUndefined();
    expect(
      refusal(() => assertPeriodOpen("2027-04-01", [march])),
    ).toBeUndefined();
    expect(
      refusal(() => assertPeriodOpen("2027-03-31", [closedApril])),
    ).toBeUndefined();
    expect(
      refusal(() => assertPeriodOpen("2027-05-01", [closedApril])),
    ).toBeUndefined();
  });
});
