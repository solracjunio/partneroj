import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

/**
 * Validates a request body with a schema from @partneroj/contracts, the
 * same one the web form uses. On success the route gets the parsed value
 * (trimmed, unknown fields dropped); on failure a 400 lists which fields
 * were wrong, never the values sent.
 *
 *   @Body(new ZodBody(newExpense)) body: NewExpense
 */
export class ZodBody<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "invalid_body",
        fields: [...new Set(result.error.issues.map((i) => i.path.join(".")))],
      });
    }
    return result.data;
  }
}
