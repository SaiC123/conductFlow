/**
 * The whole of our error reporting. console.error lands in Vercel's runtime logs on every
 * plan at no cost; a hosted error service is a paid dependency and a later decision.
 *
 * Never throws: a logger that can fail an action is worse than no logger.
 */
export function logFailure(where: string, error: unknown): void {
  if (!error) return;
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "object") {
    try {
      message = JSON.stringify(error);
    } catch {
      message = Object.prototype.toString.call(error);
    }
  } else {
    message = String(error);
  }
  console.error(`[conductflow] ${where}: ${message}`);
}
