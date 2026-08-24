import { logFailure } from "@/lib/observability/log";

/**
 * What a Server Action says when it could not do the thing.
 *
 * Next.js replaces the message of anything *thrown* out of a Server Action in a production
 * build with "An error occurred in the Server Components render. The specific message is
 * omitted in production builds to avoid leaking sensitive details." That is the correct
 * default for a framework and the wrong one for this app: the sentences these actions throw
 * are written for the owner reading them — "Connect Google Drive first", "reopen the task
 * before marking it in progress", "the writing model is rate-limited, try again in a
 * minute". Redacted, every one of them becomes the same dead end.
 *
 * So failures come back as data. `lib/limits/rate-limit.ts` and `app/actions/waitlist.ts`
 * already did this one refusal at a time; this is the same idea applied once, in a place
 * every action can share, so the next action written gets it without remembering to.
 */
export interface ActionFailed {
  error: string;
}

export function failed(result: unknown): result is ActionFailed {
  return typeof result === "object" && result !== null
    && typeof (result as ActionFailed).error === "string";
}

/**
 * `redirect()` and `notFound()` work by throwing. Catching those would turn a redirect into
 * an error message and leave the owner staring at the page they were supposed to leave.
 */
function isControlFlow(thrown: unknown): boolean {
  const digest = (thrown as { digest?: unknown } | null | undefined)?.digest;
  return typeof digest === "string"
    && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

/**
 * A Supabase error is a plain object — `code`, `details`, `hint`, `message` — not an Error.
 * Its message names columns, constraints and RLS policies, which is a description of the
 * schema rather than something an owner can act on. Those go to the log and the reader gets
 * a sentence; anything raised as a real `Error` was written to be read and passes through.
 */
const OPAQUE = "That did not save. Nothing was changed — try again, and if it keeps "
  + "happening the details are in the server log.";

/**
 * Runs an action body and turns any failure into a returned message.
 *
 * `label` only ever reaches the server log, so it can name the function plainly.
 */
export async function reportable<T>(
  label: string, run: () => Promise<T>,
): Promise<T | ActionFailed> {
  try {
    return await run();
  } catch (thrown) {
    if (isControlFlow(thrown)) throw thrown;
    if (thrown instanceof Error) {
      // Logged as well as returned: the message reaches one person on one screen, and
      // whoever looks at the deployment later gets the stack.
      logFailure(label, thrown);
      return { error: thrown.message };
    }
    logFailure(label, thrown);
    return { error: OPAQUE };
  }
}
