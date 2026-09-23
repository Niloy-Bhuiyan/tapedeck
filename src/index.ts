/**
 * TapeDeck: VCR for AI agents.
 *
 * Record every LLM call, tool call, clock read and random draw an agent
 * makes into a tape; replay it later with zero API cost; diff runs to catch
 * regressions.
 */
import { activateFromEnv } from './runtime/env.js';

export { record, type RecordOptions, type RecordResult } from './record.js';
export { replay, type ReplayOptions, type ReplayResult } from './replay.js';
export { TapeDivergenceError, type ReplayMode } from './runtime/replay-session.js';
export {
  diffTapes,
  describeEvent,
  describeStep,
  type DiffOptions,
  type DiffStep,
  type OutcomeDiff,
  type StepStatus,
  type TapeDiff,
} from './diff/diff.js';
export type { FieldChange } from './diff/deep.js';

export {
  NotInstrumentedError,
  quoteCommand,
  recordCommand,
  replayCommand,
  type CommandReplayResult,
  type CommandRun,
  type RecordCommandOptions,
  type ReplayCommandOptions,
} from './process.js';

export { tool } from './interceptors/tool.js';
export { wrapClient } from './interceptors/client.js';
export { ANTHROPIC_OPERATIONS, OPENAI_OPERATIONS, wrapAnthropic, wrapOpenAI } from './interceptors/providers.js';

export { formatForPath, parseTape, readTapeFile, serializeTape, writeTapeFile, type TapeFileFormat } from './tape/io.js';
export { TapeFormatError, validateTape } from './tape/validate.js';
export * from './tape/schema.js';

// MOCK: deterministic offline providers, see MOCKED_COMPONENTS.md.
export { MockOpenAI, echoResponder, type MockChatCompletion, type MockChatParams } from './mock/openai.js';
export { MockAnthropic, echoMessageResponder, type MockMessage, type MockMessageParams } from './mock/anthropic.js';
export type { MockReply, MockResponder, MockToolCall } from './mock/reply.js';

export { formatDiff, formatTimeline, type FormatOptions } from './format/text.js';
export { VERSION } from './version.js';

// When launched by `tapedeck record` / `tapedeck replay --against`, bind
// a session to the app as soon as it imports TapeDeck.
activateFromEnv();
