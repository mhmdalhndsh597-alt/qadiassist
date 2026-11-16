import { z } from 'zod';

export const caseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  documentCount: z.number().int().nonnegative().optional(),
});

export const sourceRefSchema = z.object({
  documentId: z.string().uuid(),
  fileName: z.string(),
  segmentId: z.string().uuid(),
  pageNumber: z.number().int().positive().nullable(),
  segmentNumber: z.number().int().positive(),
  excerpt: z.string(),
});

export const eventSchema = z.object({
  id: z.string().uuid(),
  date: z.string().nullable(),
  dateLabel: z.string(),
  description: z.string(),
  significance: z.string().optional(),
  sources: z.array(sourceRefSchema).min(1),
  reviewStatus: z.enum(['ai_draft', 'edited', 'approved']).default('ai_draft'),
});

export const entitySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(['person', 'organization', 'place', 'document', 'other']),
  role: z.string().optional(),
  sources: z.array(sourceRefSchema).min(1),
  reviewStatus: z.enum(['ai_draft', 'edited', 'approved']).default('ai_draft'),
});

export const analysisSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  summary: z.string(),
  summarySources: z.array(sourceRefSchema).min(1),
  events: z.array(eventSchema),
  entities: z.array(entitySchema),
  reviewNotes: z.array(z.string()),
  status: z.enum(['ai_draft', 'edited', 'approved']).default('ai_draft'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const documentSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.enum([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  sizeBytes: z.number().int().positive(),
  pageCount: z.number().int().nonnegative().nullable(),
  status: z.enum(['processing', 'ready', 'failed', 'deleted']),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  sourceCount: z.number().int().nonnegative(),
});

export const sourceSegmentSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  fileName: z.string(),
  pageNumber: z.number().int().positive().nullable(),
  segmentNumber: z.number().int().positive(),
  text: z.string(),
});

export const sessionSchema = z.object({
  authenticated: z.boolean(),
  user: z
    .object({
      name: z.string(),
      email: z.string().email().optional(),
    })
    .nullable(),
});

export const createCaseSchema = z.object({
  title: z.string().trim().min(1).max(160),
});

export const updateAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(12000),
  summarySources: z.array(sourceRefSchema).min(1).max(40),
  events: z.array(eventSchema).max(250),
  entities: z.array(entitySchema).max(250),
  reviewNotes: z.array(z.string().trim().min(1).max(1000)).max(80),
});

export const aiConsentSchema = z.object({
  consentToAiProcessing: z.literal(true),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type CaseRecord = z.infer<typeof caseSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type TimelineEvent = z.infer<typeof eventSchema>;
export type CaseEntity = z.infer<typeof entitySchema>;
export type CaseAnalysis = z.infer<typeof analysisSchema>;
export type CaseDocument = z.infer<typeof documentSchema>;
export type SourceSegment = z.infer<typeof sourceSegmentSchema>;
export type SessionState = z.infer<typeof sessionSchema>;
