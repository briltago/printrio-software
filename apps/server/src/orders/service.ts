import { type OrderDto, type OrderStatus, renderFolderTemplate } from "@printrio/shared";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { orders, printJobs } from "../db/schema.ts";
import type { Library } from "../library/store.ts";
import { getWorkspaceSettings } from "../settings.ts";

export type OrderEvent = "order.created" | "order.updated" | "order.deleted";

export interface OrderCreateInput {
  name: string;
  customer?: string | null;
  status?: OrderStatus;
  notes?: string | null;
  /** Folder instead of the workspace template (may use placeholders). */
  folder?: string;
}

export interface OrderChanges {
  name?: string;
  customer?: string | null;
  status?: OrderStatus;
  notes?: string | null;
}

/**
 * Orders as one service for the HTTP API and for modules (Business creates
 * orders from accepted quotes), so both get the same folder and events.
 */
export class OrderService {
  constructor(
    private readonly db: Database,
    private readonly library: Library,
    private readonly onEvent: (event: OrderEvent, order: OrderDto) => void,
    private readonly log: { warn(data: unknown, message: string): void },
  ) {}

  async list(where?: ReturnType<typeof eq>) {
    const settings = await getWorkspaceSettings(this.db);
    const rows = await this.db
      .select({
        order: orders,
        jobCount: sql<number>`count(${printJobs.id})`,
        totalCost: sql<number>`coalesce(sum(${printJobs.totalCost}), 0)`,
      })
      .from(orders)
      .leftJoin(printJobs, eq(printJobs.orderId, orders.id))
      .where(where)
      .groupBy(orders.id)
      .orderBy(desc(orders.createdAt));
    return rows.map(
      ({ order, jobCount, totalCost }): OrderDto => ({
        id: order.id,
        name: order.name,
        customer: order.customer,
        status: order.status as OrderDto["status"],
        notes: order.notes,
        folder: order.folder,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        jobCount: Number(jobCount),
        totalCost: Number(totalCost),
        currency: settings.costs.currency,
      }),
    );
  }

  async get(id: string): Promise<OrderDto | null> {
    return (await this.list(eq(orders.id, id)))[0] ?? null;
  }

  /**
   * Gives the order a folder in the library, laid out by the workspace's folder
   * template (Settings → General). The path is chosen once and stored,
   * so renaming the order or customer never moves files. Two orders never share
   * a folder: a taken path gets " (2)", " (3)", ….
   */
  async assignFolder(order: typeof orders.$inferSelect, requested?: string) {
    const { template } = (await getWorkspaceSettings(this.db)).orderFolders;
    // A folder typed in the order form is rendered too, so it may use placeholders.
    const base = renderFolderTemplate(requested || template, {
      order: order.name,
      customer: order.customer,
      date: order.createdAt,
    });
    const taken = new Set(
      (
        await this.db
          .select({ folder: orders.folder })
          .from(orders)
          .where(and(isNotNull(orders.folder), ne(orders.id, order.id)))
      ).map((row) => row.folder),
    );
    let folder = base;
    for (let n = 2; taken.has(folder); n++) folder = `${base} (${n})`;
    await this.library.createFolder(folder);
    await this.db.update(orders).set({ folder }).where(eq(orders.id, order.id));
    return folder;
  }

  async create(input: OrderCreateInput): Promise<OrderDto> {
    const [row] = await this.db
      .insert(orders)
      .values({
        name: input.name,
        customer: input.customer ?? null,
        status: input.status ?? "new",
        notes: input.notes ?? null,
      })
      .returning();
    if (!row) throw new Error("The order could not be saved.");
    if (input.folder || (await getWorkspaceSettings(this.db)).orderFolders.enabled) {
      try {
        await this.assignFolder(row, input.folder);
      } catch (error) {
        // The order is saved either way; files can still be added later.
        this.log.warn({ err: error }, "Could not create the order folder");
      }
    }
    return this.emit("order.created", row.id) as Promise<OrderDto>;
  }

  /** Applies the given fields; null when the order does not exist. */
  async update(id: string, changes: OrderChanges): Promise<OrderDto | null> {
    const set: Partial<typeof orders.$inferInsert> = { updatedAt: new Date() };
    if (changes.name !== undefined) set.name = changes.name;
    if (changes.customer !== undefined) set.customer = changes.customer;
    if (changes.status !== undefined) set.status = changes.status;
    if (changes.notes !== undefined) set.notes = changes.notes;
    const updated = await this.db
      .update(orders)
      .set(set)
      .where(eq(orders.id, id))
      .returning({ id: orders.id });
    if (updated.length === 0) return null;
    return this.emit("order.updated", id);
  }

  async remove(id: string) {
    const before = await this.get(id);
    const deleted = await this.db.delete(orders).where(eq(orders.id, id)).returning();
    if (deleted.length === 0 || !before) return false;
    this.onEvent("order.deleted", before);
    return true;
  }

  private async emit(event: OrderEvent, id: string) {
    const order = await this.get(id);
    if (order) this.onEvent(event, order);
    return order;
  }
}
