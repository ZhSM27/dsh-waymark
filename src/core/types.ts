/** Content sizes describe one event, never a whole provider request. */
export interface EventPosition {
  readonly seq: number;
  readonly turn: number | null;
  readonly step?: number;
  readonly barrier?: boolean;
}

export interface RequestUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

interface ContentSize {
  /** Only use an authoritative size for this event's content. */
  readonly tokens?: number;
}

export type Event = EventPosition & (
  | ({ readonly kind: 'user'; readonly text: string; readonly source: 'human' | 'injected' | 'unknown' } & ContentSize)
  | ({ readonly kind: 'assistant'; readonly text: string; readonly requestUsage?: RequestUsage } & ContentSize)
  | ({ readonly kind: 'tool_call'; readonly id: string; readonly tool: string; readonly args: unknown; readonly argsText?: string;
      readonly verification?: 'test'|'build'|'lint'|'typecheck' } & ContentSize)
  | ({ readonly kind: 'tool_result'; readonly callId: string;
      readonly outcome: 'success' | 'failure' | 'unknown' | 'interrupted' | 'unresolved';
      readonly text?: string; readonly failureKey?: string;
      readonly file?: { readonly operation: 'read' | 'write' | 'edit'; readonly path: string; readonly range?: string; readonly fingerprint?: string };
      readonly outcomeSource?: 'structured' | 'text-marker' | 'unknown' } & ContentSize)
  | { readonly kind: 'boundary'; readonly reason: 'state-change' | 'context-replacement' | 'history-cut' | 'interruption' | 'unknown' }
);

export type ToolCall = Extract<Event, { kind: 'tool_call' }>;
export type ToolResult = Extract<Event, { kind: 'tool_result' }>;

export interface SessionInput {
  readonly id: string;
  readonly scope: 'full-log' | 'current-surface';
  readonly events: readonly Event[];
}

export interface Config {
  readonly failLoopMin: number;
  readonly rereadMin: number;
  readonly correctionKeywords: readonly string[];
  readonly similarityThreshold: number;
  readonly bigOutputTokens: number;
  readonly topN: number;
  /** Explicit opt-in: semantic arguments must not be silently discarded. */
  readonly volatileArgumentKeys: readonly string[];
  readonly temporaryPathPrefixes: readonly string[];
}

export interface TokenSize {
  readonly value: number | null;
  readonly method: 'reported' | 'estimated' | 'mixed' | 'unavailable';
}

export interface Evidence extends EventPosition {
  readonly kind: Event['kind'];
  readonly callId?: string;
}

interface FindingBase {
  readonly id: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly evidence: readonly Evidence[];
  readonly limitations: readonly string[];
  readonly suggestion: string;
}

export interface FailureFinding extends FindingBase {
  readonly rule: 'R1';
  readonly tool: string;
  readonly attempts: number;
  readonly match: 'exact' | 'normalized' | 'similar';
  readonly repeatedCallIds: readonly string[];
  readonly repeatedContent: TokenSize;
}

export interface OutputFinding extends FindingBase {
  readonly rule: 'R3';
  readonly output: OutputEntry;
}

export interface RereadFinding extends FindingBase {
  readonly rule: 'R2';
  readonly path: string;
  readonly reads: number;
  readonly range: string | null;
  readonly sameContentVerified: boolean;
  readonly repeatedCallIds: readonly string[];
  readonly repeatedContent: TokenSize;
}

export interface CorrectionFinding extends FindingBase {
  readonly rule: 'R4';
  readonly keyword: string;
  readonly excerpt: string;
}

export type Finding = FailureFinding | RereadFinding | OutputFinding | CorrectionFinding;

export interface OutputEntry {
  readonly callId: string;
  readonly tool: string | null;
  readonly position: EventPosition;
  readonly size: TokenSize;
  /** Only comparable when the session's entire text-content size is known. */
  readonly sessionContentRatio: number | null;
}

export interface Report {
  readonly schemaVersion: '0.1';
  readonly sessionId: string;
  readonly scope: SessionInput['scope'];
  readonly turns: number;
  readonly findings: readonly Finding[];
  readonly topOutputs: readonly OutputEntry[];
  readonly contentSize: TokenSize;
  readonly suspectedAvoidableContent: TokenSize;
  readonly suspectedAvoidableRatio: number | null;
  readonly requestUsage: TokenSize;
  readonly requestUsageCoverage: { readonly reported: number; readonly assistantMessages: number };
  readonly issues: readonly string[];
  readonly audit: {
    readonly toolCalls:number;
    readonly outcomes:Readonly<Record<ToolResult['outcome'],number>>;
    readonly tools:readonly {readonly tool:string;readonly calls:number}[];
    readonly verification:readonly {readonly kind:NonNullable<ToolCall['verification']>;readonly position:EventPosition;readonly outcome:ToolResult['outcome']}[];
  };
  readonly proposals:readonly {readonly text:string;readonly sourceFindingIds:readonly string[];readonly scope:'project-candidate'}[];
}
