import { verifySharedSecret } from "../_shared/crypto.ts";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import {
  endpoint,
  jsonResponse,
  parseJsonBytes,
  readRawBody,
} from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

async function clearStorage(organizationId: string): Promise<boolean> {
  const client = adminClient();
  const buckets = (Deno.env.get("PURGE_STORAGE_BUCKETS") ?? "").split(",").map((
    value,
  ) => value.trim()).filter(Boolean);
  for (const bucket of buckets) {
    const prefixes = [organizationId];
    const files: string[] = [];
    let scanned = 0;

    while (prefixes.length) {
      const prefix = prefixes.shift()!;
      for (let offset = 0;; offset += 1000) {
        const { data, error } = await client.storage.from(bucket).list(prefix, {
          limit: 1000,
          offset,
        });
        if (error) {
          throw new AppError(
            "TRANSIENT_PROVIDER_ERROR",
            "Storage cleanup failed.",
            true,
          );
        }
        const entries = data ?? [];
        scanned += entries.length;
        for (const entry of entries) {
          const path = `${prefix}/${entry.name}`;
          if (entry.id) files.push(path);
          else prefixes.push(path);
        }
        if (entries.length < 1000) break;
        if (scanned >= 20_000) break;
      }
      if (scanned >= 20_000) break;
    }

    for (let index = 0; index < files.length; index += 100) {
      const { error } = await client.storage.from(bucket).remove(
        files.slice(index, index + 100),
      );
      if (error) {
        throw new AppError(
          "TRANSIENT_PROVIDER_ERROR",
          "Storage cleanup failed.",
          true,
        );
      }
    }
    if (scanned >= 20_000) return false;
  }
  return true;
}

async function deleteAuthUsers(userIds: string[]): Promise<void> {
  const client = adminClient();
  for (const userId of userIds) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error && error.status !== 404) {
      throw new AppError(
        "TRANSIENT_PROVIDER_ERROR",
        "Auth user cleanup failed.",
        true,
      );
    }
  }
}

Deno.serve((request) =>
  endpoint(request, async (id) => {
    verifySharedSecret(
      Deno.env.get("N8N_INTERNAL_SECRET"),
      request.headers.get("x-internal-secret"),
    );
    const body = parseJsonBytes(await readRawBody(request));
    const organizationId = typeof body.organization_id === "string"
      ? body.organization_id
      : "";
    const batchSize = Number(body.batch_size ?? 500);
    if (
      !organizationId || !Number.isSafeInteger(batchSize)
    ) throw new AppError("VALIDATION_ERROR");
    const storageCleared = await clearStorage(organizationId);
    const client = adminClient();
    const first = await client.schema("crm").rpc("purge_organization_step", {
      p_organization_id: organizationId,
      p_storage_cleared: storageCleared,
      p_batch_size: batchSize,
      p_auth_users_cleared: false,
    });
    if (first.error) throw fromDatabaseError(first.error);

    let result = first.data as
      | { status?: string; auth_user_ids?: unknown }
      | null;
    if (result?.status === "waiting_auth_cleanup") {
      const userIds = Array.isArray(result.auth_user_ids)
        ? result.auth_user_ids.filter((value): value is string =>
          typeof value === "string"
        )
        : [];
      await deleteAuthUsers(userIds);
      const second = await client.schema("crm").rpc("purge_organization_step", {
        p_organization_id: organizationId,
        p_storage_cleared: true,
        p_batch_size: batchSize,
        p_auth_users_cleared: true,
      });
      if (second.error) throw fromDatabaseError(second.error);
      result = second.data as { status?: string } | null;
    }

    return jsonResponse(request, { ok: true, request_id: id, result });
  })
);
