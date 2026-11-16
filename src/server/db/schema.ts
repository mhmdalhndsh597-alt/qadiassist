import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  int,
  boolean,
  json,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

const id = (name = 'id') => varchar(name, { length: 36 }).notNull();
export const accounts = mysqlTable(
  'accounts',
  {
    id: id(),
    openId: varchar('open_id', { length: 191 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 320 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex('accounts_open_id_uq').on(t.openId)],
);
export const sessions = mysqlTable(
  'sessions',
  {
    id: id(),
    accountId: id('account_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_account_idx').on(t.accountId),
  ],
);
export const authStates = mysqlTable(
  'auth_states',
  {
    id: id(),
    stateHash: varchar('state_hash', { length: 64 }).notNull(),
    nonceHash: varchar('nonce_hash', { length: 64 }).notNull(),
    csrfHash: varchar('csrf_hash', { length: 64 }).notNull(),
    redirectUri: varchar('redirect_uri', { length: 2048 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('auth_states_state_uq').on(t.stateHash)],
);
export const cases = mysqlTable(
  'cases',
  {
    id: id(),
    accountId: id('account_id').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index('cases_owner_updated_idx').on(t.accountId, t.updatedAt)],
);
export const documents = mysqlTable(
  'documents',
  {
    id: id(),
    accountId: id('account_id').notNull(),
    caseId: id('case_id').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    sizeBytes: int('size_bytes').notNull(),
    objectKey: varchar('object_key', { length: 255 }),
    pageCount: int('page_count'),
    status: varchar('status', { length: 20 }).notNull(),
    errorMessage: varchar('error_message', { length: 255 }),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('docs_owner_case_idx').on(t.accountId, t.caseId),
    index('docs_case_status_idx').on(t.caseId, t.status),
  ],
);
export const sourceSegments = mysqlTable(
  'source_segments',
  {
    id: id(),
    accountId: id('account_id').notNull(),
    caseId: id('case_id').notNull(),
    documentId: id('document_id').notNull(),
    pageNumber: int('page_number'),
    segmentNumber: int('segment_number').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('segments_owner_case_idx').on(t.accountId, t.caseId),
    index('segments_document_idx').on(t.documentId),
  ],
);
export const analyses = mysqlTable(
  'analyses',
  {
    id: id(),
    accountId: id('account_id').notNull(),
    caseId: id('case_id').notNull(),
    summary: text('summary').notNull(),
    summarySources: json('summary_sources').$type<unknown[]>().notNull(),
    events: json('events').$type<unknown[]>().notNull(),
    entities: json('entities').$type<unknown[]>().notNull(),
    reviewNotes: json('review_notes').$type<string[]>().notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ai_draft'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index('analysis_owner_case_idx').on(t.accountId, t.caseId, t.updatedAt)],
);
