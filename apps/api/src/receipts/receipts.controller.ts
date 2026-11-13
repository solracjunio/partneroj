import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  StreamableFile,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import {
  addReceipt,
  type Database,
  findEntryForReceipt,
  findReceipt,
  type SessionMember,
} from "@partneroj/db";

import { CurrentMember, SessionGuard } from "../auth/session.guard.js";
import { DATABASE } from "../database/database.module.js";
import { normalizeReceipt, ReceiptRejected } from "./normalize.js";
import { mayAddReceipt } from "./rules.js";
import { RECEIPT_STORAGE, type ReceiptStorage } from "./storage.js";

/** Same limit as Caddy's request_body and the receipts table's check. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the raw request body, refusing more than the limit as soon as it
 * passes it. The file is the whole body (fetch with a Blob), so there is
 * no multipart parsing and no dependency for it.
 */
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException();
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

@Controller()
@UseGuards(SessionGuard)
export class ReceiptsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RECEIPT_STORAGE) private readonly storage: ReceiptStorage,
  ) {}

  /**
   * Attaches a photo or PDF to an entry, by who recorded it
   * (receipts/rules.ts). The body is the file itself.
   */
  @Post("entries/:entryId/receipts")
  async upload(
    @CurrentMember() member: SessionMember,
    @Param("entryId") entryId: string,
    @Req() request: IncomingMessage,
  ): Promise<{ id: string; contentType: string; sizeBytes: number }> {
    const scope = { entryId, partnershipId: member.partnershipId };
    // Before reading the body: nothing is processed or stored for an
    // entry that is not the member's partnership's, nor by someone who
    // didn't record it.
    const entry = UUID.test(entryId)
      ? await findEntryForReceipt(this.db, scope)
      : null;
    if (entry === null) throw new NotFoundException();
    if (!mayAddReceipt(member, entry)) throw new ForbiddenException();

    let file;
    try {
      file = await normalizeReceipt(await readBody(request));
    } catch (error) {
      if (error instanceof ReceiptRejected) {
        throw new UnsupportedMediaTypeException(error.reason);
      }
      throw error;
    }

    // The key comes from the content: the same file sent again lands on
    // the same key, and addReceipt finds the receipt already recorded.
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    const storageKey = `receipts/${entryId}/${sha256}.${file.extension}`;
    await this.storage.save(storageKey, file.bytes);

    const added = await addReceipt(this.db, {
      ...scope,
      uploadedBy: member.memberId,
      storageKey,
      contentType: file.contentType,
      sizeBytes: file.bytes.length,
      sha256,
    });
    if (added === null) throw new NotFoundException();
    return {
      id: added.id,
      contentType: file.contentType,
      sizeBytes: file.bytes.length,
    };
  }

  /** The file, for anyone of the partnership (plan section 2: all see all). */
  @Get("receipts/:receiptId")
  // A receipt never changes (its key is its hash), but it is private:
  // only the browser of whoever downloaded it may keep a copy.
  @Header("Cache-Control", "private, max-age=86400, immutable")
  @Header("X-Content-Type-Options", "nosniff")
  async download(
    @CurrentMember() member: SessionMember,
    @Param("receiptId") receiptId: string,
  ): Promise<StreamableFile> {
    const receipt = UUID.test(receiptId)
      ? await findReceipt(this.db, {
          receiptId,
          partnershipId: member.partnershipId,
        })
      : null;
    if (receipt === null) throw new NotFoundException();
    const bytes = await this.storage.read(receipt.storageKey);
    return new StreamableFile(bytes, {
      type: receipt.contentType,
      length: bytes.length,
      disposition: "inline",
    });
  }
}
