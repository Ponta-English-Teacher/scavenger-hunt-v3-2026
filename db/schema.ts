import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(), title: text("title").notNull(), topic: text("topic").notNull(), level: text("level").notNull(),
  identityMode: text("identity_mode").notNull(), studentCount: integer("student_count").notNull(),
  rosterJson: text("roster_json").notNull().default("[]"), questionsJson: text("questions_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
