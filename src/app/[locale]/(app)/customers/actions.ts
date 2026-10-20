"use server";

import { revalidatePath } from "next/cache";
import { logCommunication } from "@/modules/crm/communications";
import {
  addContact,
  archiveCustomer,
  createCustomer,
  deleteContact,
  restoreCustomer,
  setPrimaryContact,
  updateCustomer,
} from "@/modules/crm/customers";
import type { CommunicationInput, ContactInput, CustomerInput } from "@/modules/crm/schemas";
import { run, type ActionResult } from "@/server/actions";

const refresh = () => revalidatePath("/", "layout");

export async function createCustomerAction(
  input: CustomerInput,
): Promise<ActionResult<{ id: string }>> {
  return run(async (ctx) => {
    const customer = await createCustomer(ctx, input);
    refresh();
    return { id: customer.id };
  });
}

export async function updateCustomerAction(
  id: string,
  input: CustomerInput,
): Promise<ActionResult> {
  return run(async (ctx) => {
    await updateCustomer(ctx, id, input);
    refresh();
    return {};
  });
}

export async function archiveCustomerAction(id: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await archiveCustomer(ctx, id);
    refresh();
    return {};
  });
}

export async function restoreCustomerAction(id: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await restoreCustomer(ctx, id);
    refresh();
    return {};
  });
}

export async function addContactAction(
  customerId: string,
  input: ContactInput,
): Promise<ActionResult> {
  return run(async (ctx) => {
    await addContact(ctx, customerId, input);
    refresh();
    return {};
  });
}

export async function setPrimaryContactAction(contactId: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await setPrimaryContact(ctx, contactId);
    refresh();
    return {};
  });
}

export async function deleteContactAction(contactId: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await deleteContact(ctx, contactId);
    refresh();
    return {};
  });
}

export async function logCommunicationAction(input: CommunicationInput): Promise<ActionResult> {
  return run(async (ctx) => {
    await logCommunication(ctx, input);
    refresh();
    return {};
  });
}
