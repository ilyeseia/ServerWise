/** Plain, serializable shapes passed from server pages to client components. */

export interface ContactRow {
  id: string;
  name: string;
  jobTitle: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}

export interface FollowUpRow {
  id: string;
  title: string;
  dueLabel: string;
  overdue: boolean;
  status: "open" | "done" | "cancelled";
  customerId: string;
  customerName: string;
  leadId: string | null;
  leadTitle: string | null;
  assignedToName: string | null;
  notes: string | null;
}

export interface CommunicationRow {
  id: string;
  channel: string;
  direction: "inbound" | "outbound";
  whenLabel: string;
  summary: string;
  leadId: string | null;
  leadTitle: string | null;
  authorName: string | null;
}

export interface PersonOption {
  id: string;
  name: string;
}

export interface LeadOption {
  id: string;
  title: string;
}
