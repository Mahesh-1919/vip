import { timestamp, uuid, integer } from "drizzle-orm/pg-core";

export const id = () => uuid().primaryKey().defaultRandom();
export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date());
/** Optimistic-lock counter: UPDATE ... WHERE version = :seen, then version + 1. */
export const version = () => integer().notNull().default(1);
