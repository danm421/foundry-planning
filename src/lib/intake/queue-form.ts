import type { IntakeFormRow } from "./queries";

/**
 * The fields the Data Collection queue shows. The queue is a client component,
 * so its props are serialized into the page; a whole form row would carry the
 * client's answers and the access token along with it.
 */
export type QueueForm = Pick<
  IntakeFormRow,
  | "id"
  | "clientId"
  | "status"
  | "recipientEmail"
  | "recipientName"
  | "sentAt"
  | "openedAt"
  | "submittedAt"
  | "appliedAt"
  | "expiresAt"
  | "createdAt"
  | "updatedAt"
>;

export const toQueueForm = (f: IntakeFormRow): QueueForm => ({
  id: f.id,
  clientId: f.clientId,
  status: f.status,
  recipientEmail: f.recipientEmail,
  recipientName: f.recipientName,
  sentAt: f.sentAt,
  openedAt: f.openedAt,
  submittedAt: f.submittedAt,
  appliedAt: f.appliedAt,
  expiresAt: f.expiresAt,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});
