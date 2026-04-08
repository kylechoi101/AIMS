import { pgTable, uuid, text, integer, timestamp, primaryKey, index, check, date, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  timezone: text('timezone').default('UTC'),
  midnightUtcHour: integer('midnight_utc_hour').default(0)
});

export const rooms = pgTable('rooms', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  status: text('status').default('brainstorming'),
  details: jsonb('details'),
}, (t) => ({
  checkStatus: check('status_check', sql`${t.status} IN ('brainstorming', 'scoping', 'building', 'shipped')`)
}));

export const roomMembers = pgTable('room_members', {
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.roomId, t.userId] })
}));

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }).notNull(),
  senderId: uuid('sender_id').references(() => users.id),
  senderType: text('sender_type').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (t) => ({
  idxMessagesRoomCreated: index('idx_messages_room_created').on(t.roomId, t.createdAt),
  checkSenderType: check('sender_type_check', sql`${t.senderType} IN ('user', 'agent')`)
}));

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id').references(() => users.id).primaryKey(),
  aiProvider: text('ai_provider'),
  tier: text('tier').default('free')
}, (t) => ({
  checkAiProvider: check('ai_provider_check', sql`${t.aiProvider} IN ('openai', 'anthropic', 'gemini')`),
  checkTier: check('tier_check', sql`${t.tier} IN ('free', 'premium')`)
}));

export const chimeUsage = pgTable('chime_usage', {
  userId: uuid('user_id').references(() => users.id).notNull(),
  usageDate: date('date').defaultNow().notNull(),
  count: integer('count').default(1).notNull()
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.usageDate] })
}));
