import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  type Choice,
  choiceChange,
  type ChoiceChange,
  choiceListQuery,
  type ChoiceListQuery,
  newChoice,
  type NewChoice,
} from "@partneroj/contracts";
import {
  archiveChoice,
  type Choice as ChoiceRow,
  type ChoiceKind,
  ChoiceRefused,
  createChoice,
  type Database,
  listChoices,
  renameChoice,
  restoreChoice,
  type SessionMember,
} from "@partneroj/db";

import { CurrentMember, SessionGuard } from "../auth/session.guard.js";
import { DATABASE } from "../database/database.module.js";
import { ZodBody } from "../validation/zod-body.pipe.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toChoice = (row: ChoiceRow): Choice => ({
  id: row.id,
  name: row.name,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

/**
 * Accounts and categories (plan section 8): every member reads them,
 * readers included; only admins create, rename, archive or restore
 * (plan section 2). The partnership is always the session's.
 */
@Controller()
@UseGuards(SessionGuard)
export class ChoicesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get("accounts")
  @Header("Cache-Control", "no-store")
  listAccounts(
    @CurrentMember() member: SessionMember,
    @Query(new ZodBody(choiceListQuery)) query: ChoiceListQuery,
  ): Promise<Choice[]> {
    return this.list(member, "account", query);
  }

  @Get("categories")
  @Header("Cache-Control", "no-store")
  listCategories(
    @CurrentMember() member: SessionMember,
    @Query(new ZodBody(choiceListQuery)) query: ChoiceListQuery,
  ): Promise<Choice[]> {
    return this.list(member, "category", query);
  }

  @Post("accounts")
  createAccount(
    @CurrentMember() actor: SessionMember,
    @Body(new ZodBody(newChoice)) body: NewChoice,
  ): Promise<Choice> {
    return this.create(actor, "account", body);
  }

  @Post("categories")
  createCategory(
    @CurrentMember() actor: SessionMember,
    @Body(new ZodBody(newChoice)) body: NewChoice,
  ): Promise<Choice> {
    return this.create(actor, "category", body);
  }

  @Patch("accounts/:id")
  changeAccount(
    @CurrentMember() actor: SessionMember,
    @Param("id") id: string,
    @Body(new ZodBody(choiceChange)) body: ChoiceChange,
  ): Promise<Choice> {
    return this.change(actor, "account", id, body);
  }

  @Patch("categories/:id")
  changeCategory(
    @CurrentMember() actor: SessionMember,
    @Param("id") id: string,
    @Body(new ZodBody(choiceChange)) body: ChoiceChange,
  ): Promise<Choice> {
    return this.change(actor, "category", id, body);
  }

  private async list(
    member: SessionMember,
    kind: ChoiceKind,
    query: ChoiceListQuery,
  ): Promise<Choice[]> {
    const rows = await listChoices(this.db, member.partnershipId, kind, {
      includeArchived: query.archived === "include",
    });
    return rows.map(toChoice);
  }

  private async create(
    actor: SessionMember,
    kind: ChoiceKind,
    body: NewChoice,
  ): Promise<Choice> {
    if (actor.role !== "admin") throw new ForbiddenException();
    return toChoice(
      await refusals(createChoice(this.db, actor, kind, body.name)),
    );
  }

  private async change(
    actor: SessionMember,
    kind: ChoiceKind,
    id: string,
    body: ChoiceChange,
  ): Promise<Choice> {
    if (actor.role !== "admin") throw new ForbiddenException();
    // Not an id: no row has it, the same as another partnership's.
    if (!UUID.test(id)) throw new NotFoundException("not-found");
    const changed =
      "name" in body
        ? renameChoice(this.db, actor, kind, id, body.name)
        : body.archived
          ? archiveChoice(this.db, actor, kind, id)
          : restoreChoice(this.db, actor, kind, id);
    return toChoice(await refusals(changed));
  }
}

/** A refusal becomes its response; anything else is a bug (500). */
async function refusals(change: Promise<ChoiceRow>): Promise<ChoiceRow> {
  try {
    return await change;
  } catch (error) {
    if (!(error instanceof ChoiceRefused)) throw error;
    switch (error.reason) {
      // Another partnership's looks the same as one that doesn't exist.
      case "not-found":
        throw new NotFoundException(error.reason);
      case "name-taken":
      case "account-not-empty":
        throw new ConflictException(error.reason);
    }
  }
}
