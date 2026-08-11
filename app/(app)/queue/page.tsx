import { listCommitments } from "@/lib/db/queries";
import { CommitmentList } from "@/components/queue/CommitmentList";
const DEMO_ORG = "00000000-0000-0000-0000-00000000000a";
export default async function QueuePage() {
  const items = await listCommitments(DEMO_ORG);
  return (<main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
    <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Commitment queue</h1>
    <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
      Review AI-extracted promises. Nothing is sent — you approve every action.</p>
    <CommitmentList items={items} />
  </main>);
}
