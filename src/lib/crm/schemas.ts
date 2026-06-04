import { z } from "zod";

export const crmHouseholdStatusSchema = z.enum(["prospect", "active", "inactive", "archived"]);
export const crmContactRoleSchema = z.enum(["primary", "spouse", "dependent", "other"]);
export const crmActivityKindSchema = z.enum([
  "note", "call", "meeting", "email", "status_change",
  "contact_change", "account_change", "document_uploaded", "planning_link",
]);

// Minimal contact captured inline when a household is first created
// (primary + optional spouse). Fuller contact details are added later on
// the household's Contacts tab via createCrmContactSchema.
export const createCrmHouseholdContactSchema = z.object({
  role: crmContactRoleSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.iso.date().optional(),
});

export const createCrmHouseholdSchema = z.object({
  name: z.string().min(1).max(200),
  status: crmHouseholdStatusSchema.default("prospect"),
  advisorId: z.string().min(1),
  notes: z.string().max(5000).optional(),
  contacts: z.array(createCrmHouseholdContactSchema).optional(),
});

export const updateCrmHouseholdSchema = createCrmHouseholdSchema.partial();

export const createCrmContactSchema = z.object({
  role: crmContactRoleSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  preferredName: z.string().max(100).optional(),
  dateOfBirth: z.iso.date().optional(),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  mobile: z.string().max(40).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  ssnLast4: z.string().regex(/^\d{4}$/).optional(),
  maritalStatus: z.string().max(50).optional(),
  employmentStatus: z.string().max(50).optional(),
  employer: z.string().max(200).optional(),
  occupation: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateCrmContactSchema = createCrmContactSchema.partial();

export const createCrmAccountSchema = z.object({
  contactId: z.uuid().nullable().optional(),
  accountType: z.string().max(100).optional(),
  custodian: z.string().max(100).optional(),
  accountNumberLast4: z.string().regex(/^\d{4}$/).optional(),
  balance: z.number().nonnegative().optional(),
  balanceAsOf: z.iso.date().optional(),
  notes: z.string().max(5000).optional(),
});

export const updateCrmAccountSchema = createCrmAccountSchema.partial();

export const createCrmActivitySchema = z.object({
  kind: crmActivityKindSchema,
  title: z.string().min(1).max(300),
  body: z.string().max(20000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.iso.datetime().optional(),
});

export type CreateCrmHouseholdContactInput = z.infer<typeof createCrmHouseholdContactSchema>;
export type CreateCrmHouseholdInput = z.infer<typeof createCrmHouseholdSchema>;
export type CreateCrmContactInput = z.infer<typeof createCrmContactSchema>;
export type CreateCrmAccountInput = z.infer<typeof createCrmAccountSchema>;
export type CreateCrmActivityInput = z.infer<typeof createCrmActivitySchema>;
