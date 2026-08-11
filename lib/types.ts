export type Confidence = "high" | "medium" | "low";
export type CommitmentStatus = "proposed" | "approved" | "tasked" | "done";
export type Role = "owner" | "member";

export interface Org {
  id: string;
  name: string;
  created_at: string;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Commitment {
  id: string; org_id: string; conversation_id: string; client_id: string;
  text: string; owner: string | null; deadline: string | null;
  type: string; confidence: Confidence; source_span: string;
  status: CommitmentStatus; created_at: string;
}
export interface DeliverableDraft {
  id: string; org_id: string; commitment_id: string; kind: "email" | "recap";
  subject: string | null; body: string; created_at: string;
}
export interface ApprovalEvent {
  id: string; org_id: string; subject_type: string; subject_id: string;
  state: "proposed" | "approved" | "rejected" | "executed";
  actor_user_id: string | null; created_at: string;
}
