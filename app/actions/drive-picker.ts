"use server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServiceClient } from "@/lib/db/service";
import { CAPABILITIES } from "@/lib/google/scopes";
import { DataSourceUnavailable, getAccessToken } from "@/lib/google/tokens";

type PickerTokenResult = string | { error: "signed_out" | "connect_drive" | "token_error" };

export async function getDrivePickerToken(): Promise<PickerTokenResult> {
  try {
    const orgId = await getCurrentOrgId();
    if (!orgId) return { error: "signed_out" };
    return await getAccessToken(getServiceClient(), orgId, CAPABILITIES.drive_templates.scopes[0]);
  } catch (error) {
    if (error instanceof DataSourceUnavailable && error.reason !== "refused")
      return { error: "connect_drive" };
    return { error: "token_error" };
  }
}
