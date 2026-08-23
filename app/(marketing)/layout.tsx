import type { ReactNode } from "react";

/**
 * Exists only to mark the marketing routes, so `.cf-marketing` can put Clash Display on
 * their headings. Satoshi is the whole site's text face and is set on `body`; the display
 * face is not, because it is drawn for the sizes this side of the app uses and reads as
 * costume at 15px on a queue screen.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="cf-marketing">{children}</div>;
}
