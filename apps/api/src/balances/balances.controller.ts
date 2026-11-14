import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  UseGuards,
} from "@nestjs/common";
import type { ProjectBalances } from "@partneroj/contracts";
import {
  type Database,
  projectBalances,
  type SessionMember,
} from "@partneroj/db";

import { CurrentMember, SessionGuard } from "../auth/session.guard.js";
import { DATABASE } from "../database/database.module.js";

@Controller()
@UseGuards(SessionGuard)
export class BalancesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * "Saldos": the current project's balances, for every member, readers
   * included (plan section 2). The partnership is the session's.
   */
  @Get("projects/current/balances")
  @Header("Cache-Control", "no-store")
  async balances(
    @CurrentMember() member: SessionMember,
  ): Promise<ProjectBalances> {
    const found = await projectBalances(this.db, member.partnershipId);
    if (found === null) throw new NotFoundException("no_project");
    const cents = (value: bigint) => value.toString();
    return {
      project: found.project,
      sameWeights: found.sameWeights,
      resultCents: cents(found.result),
      partners: found.partners.map((p) => ({
        memberId: p.memberId,
        name: p.name,
        weight: p.weight,
        contributedCents: cents(p.contributions),
        withdrawnCents: cents(p.withdrawals),
        resultPartCents: cents(p.resultPart),
        balanceCents: cents(p.balance),
        fairShareCents: cents(p.fairShare),
      })),
      accounts: found.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        balanceCents: cents(a.balance),
      })),
    };
  }
}
