// server/upstreamFaults.ts — recognise the assistant's own infrastructure failing.
//
// Hermes owns a session store for every conversation. When its SQLite WAL
// generation is stranded (a sibling process closed and unlinked the -wal while
// this one still held it) it refuses to write, and that failure travels back
// through the chat completion as if it were text. Two arrival shapes:
//
//   1. a non-2xx body, or
//   2. a 200 whose `message.content` IS the error paragraph — which BeeTree used
//      to render in the chat bubble and persist as the assistant's answer.
//
// Shape 2 is the reason this module exists: a stack trace in a chat bubble reads
// as the product being broken, and it survives a reload because it got stored.
//
// Anchored on error class names and the operator-facing sentences Hermes writes,
// never on "state.db" alone — a legitimate beekeeping answer can mention a
// database, and a false positive here would swallow a real reply.

const TRANSIENT_STORAGE_FAULT =
  /DeletedWalGenerationError|StateDbReplacedError|StateDbCorruptError|session storage stopped writing|database is locked|database disk image is malformed/i;

/** True when this text is an upstream storage failure rather than an answer. */
export function isTransientStorageFault(text: string | null | undefined): boolean {
  return !!text && TRANSIENT_STORAGE_FAULT.test(text);
}

/** What the beekeeper is told when the assistant's storage is unavailable. */
export const STORAGE_FAULT_MESSAGE =
  "The assistant's session storage is restarting. Nothing was lost — try again in a moment.";
