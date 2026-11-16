import { z } from 'zod';

export const sourceCitationSchema = z.strictObject({
  segmentId: z.string().uuid(),
  excerpt: z.string().trim().min(1).max(1200),
});

export const reviewNoteSchema = z.string().trim().min(1).max(1000);

export type RawCitation = z.infer<typeof sourceCitationSchema>;
export type AgentId = 'summary' | 'timeline' | 'entities';

export interface AnalysisSource {
  segmentId: string;
  documentId: string;
  fileName: string;
  pageNumber: number | null;
  segmentNumber: number;
  text: string;
}

export interface AgentTask {
  id: AgentId;
  label: string;
  instruction: string;
}

export interface AgentDefinition<T> extends AgentTask {
  outputSchema: z.ZodType<T>;
}

export interface RawTimelineEvent {
  date: string | null;
  dateLabel: string;
  description: string;
  significance?: string;
  sources: RawCitation[];
}

export interface AgentStatus {
  id: AgentId;
  label: string;
  status: 'completed' | 'failed';
  durationMs: number;
  failureCode?: 'provider' | 'rate_limited' | 'timeout' | 'invalid_output';
}

export interface AgentRun<T> {
  status: AgentStatus;
  output?: T;
}

export type AgentCall = (input: {
  agent: AgentTask;
  sources: readonly AnalysisSource[];
  repair?: string;
}) => Promise<string>;

export interface RawParallelAnalysis {
  summary: string;
  summarySources: RawCitation[];
  events: RawTimelineEvent[];
  entities: Array<{
    name: string;
    type: 'person' | 'organization' | 'place' | 'document' | 'other';
    role?: string;
    sources: RawCitation[];
  }>;
  reviewNotes: string[];
}
