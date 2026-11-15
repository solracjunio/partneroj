import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  BALLOT_DAYS,
  closesAt,
  tallyBallot,
  type Ballot,
  type CastVote,
} from "./ballot.js";

const opened = new Date("2027-02-01T12:00:00Z");
const deadline = closesAt(opened);
const hour = (h: number) => new Date(opened.getTime() + h * 3_600_000);
const afterDeadline = new Date(deadline.getTime() + 1);

const vote = (voter: string, v: "yes" | "no", h: number): CastVote => ({
  voter,
  vote: v,
  at: hour(h),
});

const ballot = (over: Partial<Ballot>): Ballot => ({
  rule: "majority",
  electorate: ["A", "B", "C"],
  closesAt: deadline,
  votes: [],
  ...over,
});

const applies = () => true;

describe("closesAt", () => {
  it(`gives the ballot ${BALLOT_DAYS} days`, () => {
    expect(BALLOT_DAYS).toBe(7);
    expect(closesAt(opened)).toEqual(new Date("2027-02-08T12:00:00Z"));
  });
});

describe("tallyBallot, by absolute majority", () => {
  it("stays open while the result can still change", () => {
    const tally = tallyBallot(
      ballot({ votes: [vote("A", "yes", 1)] }),
      hour(2),
      applies,
    );
    expect(tally).toEqual({ state: "open", yes: 1, no: 0 });
  });

  it("closes approved on the vote that makes it more than half", () => {
    const tally = tallyBallot(
      ballot({ votes: [vote("A", "yes", 1), vote("B", "yes", 5)] }),
      hour(6),
      applies,
    );
    expect(tally).toEqual({
      state: "closed",
      outcome: "approved",
      closedAt: hour(5),
      yes: 2,
      no: 0,
    });
  });

  it("closes rejected once enough say no that yes can't pass", () => {
    const tally = tallyBallot(
      ballot({ votes: [vote("A", "no", 1), vote("B", "no", 2)] }),
      hour(3),
      applies,
    );
    expect(tally).toMatchObject({
      state: "closed",
      outcome: "rejected",
      closedAt: hour(2),
    });
  });

  it("rejects a tie: half is not more than half", () => {
    const tally = tallyBallot(
      ballot({
        electorate: ["A", "B", "C", "D"],
        votes: [
          vote("A", "yes", 1),
          vote("B", "yes", 2),
          vote("C", "no", 3),
          vote("D", "no", 4),
        ],
      }),
      hour(5),
      applies,
    );
    expect(tally).toMatchObject({ outcome: "rejected", closedAt: hour(4) });
  });

  it("counts whoever didn't vote as no, at the deadline", () => {
    const tally = tallyBallot(
      ballot({ votes: [vote("A", "yes", 1)] }),
      afterDeadline,
      applies,
    );
    expect(tally).toEqual({
      state: "closed",
      outcome: "rejected",
      closedAt: deadline,
      yes: 1,
      no: 0,
    });
  });

  it("is still open at the deadline's last moment before it", () => {
    const tally = tallyBallot(
      ballot({ votes: [] }),
      new Date(deadline.getTime() - 1),
      applies,
    );
    expect(tally.state).toBe("open");
  });

  it("closes at the deadline itself", () => {
    expect(tallyBallot(ballot({}), deadline, applies)).toMatchObject({
      state: "closed",
      outcome: "rejected",
      closedAt: deadline,
    });
  });
});

describe("tallyBallot, with the votes as the database gives them", () => {
  it("orders the votes by time, whatever order they come in", () => {
    // Read in this order, B's yes and A's yes would close it at hour 1.
    const tally = tallyBallot(
      ballot({
        votes: [vote("B", "yes", 5), vote("C", "no", 3), vote("A", "yes", 1)],
      }),
      hour(6),
      applies,
    );
    expect(tally).toMatchObject({ outcome: "approved", closedAt: hour(5) });
  });

  it("doesn't count a vote cast at the deadline or after it", () => {
    const late = { voter: "B", vote: "yes" as const, at: deadline };
    const tally = tallyBallot(
      ballot({ votes: [vote("A", "yes", 1), late] }),
      afterDeadline,
      applies,
    );
    expect(tally).toMatchObject({ outcome: "rejected", yes: 1 });
  });

  it("counts a vote read at the very moment it was cast", () => {
    const tally = tallyBallot(
      ballot({ votes: [vote("A", "yes", 1)] }),
      hour(1),
      applies,
    );
    expect(tally).toEqual({ state: "open", yes: 1, no: 0 });
  });

  it("counts yes and no apart while open", () => {
    const tally = tallyBallot(
      ballot({
        electorate: ["A", "B", "C", "D", "E"],
        votes: [vote("A", "no", 1), vote("B", "yes", 2)],
      }),
      hour(3),
      applies,
    );
    expect(tally).toEqual({ state: "open", yes: 1, no: 1 });
  });
});

describe("tallyBallot, by unanimity (ADR 0004)", () => {
  const unanimity = (votes: CastVote[]) => ballot({ rule: "unanimity", votes });

  it("isn't approved by a majority", () => {
    const tally = tallyBallot(
      unanimity([vote("A", "yes", 1), vote("B", "yes", 2)]),
      hour(3),
      applies,
    );
    expect(tally).toEqual({ state: "open", yes: 2, no: 0 });
  });

  it("is approved when everyone says yes", () => {
    const tally = tallyBallot(
      unanimity([
        vote("A", "yes", 1),
        vote("B", "yes", 2),
        vote("C", "yes", 3),
      ]),
      hour(4),
      applies,
    );
    expect(tally).toMatchObject({ outcome: "approved", closedAt: hour(3) });
  });

  it("closes rejected on the first no", () => {
    const tally = tallyBallot(
      unanimity([vote("A", "yes", 1), vote("B", "no", 2)]),
      hour(3),
      applies,
    );
    expect(tally).toMatchObject({ outcome: "rejected", closedAt: hour(2) });
  });

  it("is rejected at the deadline by whoever didn't vote", () => {
    const tally = tallyBallot(
      unanimity([vote("A", "yes", 1), vote("B", "yes", 2)]),
      afterDeadline,
      applies,
    );
    expect(tally).toMatchObject({ outcome: "rejected", closedAt: deadline });
  });
});

describe("tallyBallot, when the author reverses the entry", () => {
  it("is moot when the reversal comes before the end", () => {
    const tally = tallyBallot(
      ballot({ votes: [vote("A", "yes", 1)], reversedAt: hour(2) }),
      hour(3),
      applies,
    );
    expect(tally).toEqual({
      state: "closed",
      outcome: "moot",
      closedAt: hour(2),
      yes: 1,
      no: 0,
    });
  });

  it("stays decided when the reversal comes after the deciding vote", () => {
    const tally = tallyBallot(
      ballot({
        votes: [vote("A", "no", 1), vote("B", "no", 2)],
        reversedAt: hour(3),
      }),
      hour(4),
      applies,
    );
    expect(tally).toMatchObject({ outcome: "rejected", closedAt: hour(2) });
  });

  it("lets the deciding vote win a tie with the reversal", () => {
    // The reversal didn't come before the end: it came with it.
    const tally = tallyBallot(
      ballot({
        votes: [vote("A", "yes", 1), vote("B", "yes", 2)],
        reversedAt: hour(2),
      }),
      hour(3),
      applies,
    );
    expect(tally).toMatchObject({ outcome: "approved" });
  });

  it("ignores a reversal after the deadline", () => {
    const tally = tallyBallot(
      ballot({ reversedAt: afterDeadline }),
      afterDeadline,
      applies,
    );
    expect(tally).toMatchObject({ outcome: "rejected", closedAt: deadline });
  });

  it("doesn't count the votes cast after the reversal", () => {
    const tally = tallyBallot(
      ballot({
        votes: [vote("A", "yes", 1), vote("B", "yes", 3)],
        reversedAt: hour(2),
      }),
      hour(4),
      applies,
    );
    expect(tally).toMatchObject({ outcome: "moot", yes: 1 });
  });

  it("is moot when read at the very moment of the reversal", () => {
    const tally = tallyBallot(
      ballot({ votes: [vote("A", "yes", 2)], reversedAt: hour(2) }),
      hour(2),
      applies,
    );
    // A vote cast at the same moment as the reversal still counts.
    expect(tally).toMatchObject({ state: "closed", outcome: "moot", yes: 1 });
  });

  it("is still open before a reversal that is yet to come", () => {
    // Read at hour 1, the reversal at hour 2 hasn't happened.
    const tally = tallyBallot(
      ballot({ reversedAt: hour(2) }),
      hour(1),
      applies,
    );
    expect(tally.state).toBe("open");
  });
});

describe("tallyBallot, applying an approval", () => {
  const approved = ballot({
    votes: [vote("A", "yes", 1), vote("B", "yes", 2)],
  });

  it("is without effect when the proposal can no longer be applied", () => {
    // Say an account would go below zero, after entries made since it opened.
    const tally = tallyBallot(approved, hour(3), () => false);
    expect(tally).toMatchObject({ outcome: "no-effect", closedAt: hour(2) });
  });

  it("only asks whether it applies when it was approved", () => {
    const check = vi.fn(() => true);
    tallyBallot(ballot({ votes: [vote("A", "no", 1)] }), hour(2), check);
    tallyBallot(ballot({}), afterDeadline, check);
    tallyBallot(ballot({ reversedAt: hour(1) }), hour(2), check);
    expect(check).not.toHaveBeenCalled();
    tallyBallot(approved, hour(3), check);
    expect(check).toHaveBeenCalledOnce();
  });
});

describe("tallyBallot, with a frozen electorate", () => {
  it("refuses a vote from someone outside it, like a partner who joined later", () => {
    expect(() =>
      tallyBallot(ballot({ votes: [vote("D", "yes", 1)] }), hour(2), applies),
    ).toThrow(new RangeError("D is not in this ballot's electorate"));
  });

  it("still counts someone in it whose role changed since", () => {
    // B became a reader after it opened: the frozen list still has B.
    const tally = tallyBallot(
      ballot({ votes: [vote("A", "yes", 1), vote("B", "yes", 2)] }),
      hour(3),
      applies,
    );
    expect(tally).toMatchObject({ outcome: "approved" });
  });

  it("refuses a second vote from the same person: a vote can't be changed", () => {
    expect(() =>
      tallyBallot(
        ballot({ votes: [vote("A", "yes", 1), vote("A", "no", 2)] }),
        hour(3),
        applies,
      ),
    ).toThrow(new RangeError("A voted twice"));
  });

  it("refuses an empty electorate", () => {
    expect(() =>
      tallyBallot(ballot({ electorate: [] }), hour(1), applies),
    ).toThrow(new RangeError("A ballot needs an electorate"));
  });
});

describe("tallyBallot, read again and again", () => {
  it("gives the same result whenever it is read after closing", () => {
    // The job and a read can both tally it: neither may change the outcome
    // or the moment it closed.
    const votes = fc.array(
      fc.record({
        voter: fc.constantFrom("A", "B", "C", "D", "E"),
        vote: fc.constantFrom("yes" as const, "no" as const),
        hours: fc.integer({ min: 0, max: 7 * 24 - 1 }),
      }),
    );
    fc.assert(
      fc.property(
        votes,
        fc.constantFrom("majority" as const, "unanimity" as const),
        fc.option(fc.integer({ min: 0, max: 8 * 24 })),
        fc.integer({ min: 1, max: 1000 }),
        (raw, rule, reversedHour, laterHours) => {
          // One vote per person, as the database keeps it.
          const seen = new Set<string>();
          const cast = raw
            .filter((v) => !seen.has(v.voter) && seen.add(v.voter))
            .map((v) => vote(v.voter, v.vote, v.hours));
          const b = ballot({
            rule,
            electorate: ["A", "B", "C", "D", "E"],
            votes: cast,
            ...(reversedHour === null
              ? {}
              : { reversedAt: hour(reversedHour) }),
          });
          const first = tallyBallot(b, afterDeadline, applies);
          const later = tallyBallot(
            b,
            new Date(afterDeadline.getTime() + laterHours * 3_600_000),
            applies,
          );
          expect(first.state).toBe("closed");
          expect(later).toEqual(first);
        },
      ),
    );
  });
});
