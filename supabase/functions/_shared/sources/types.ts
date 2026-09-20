import type { LeadIntakeV1 } from "../contracts.ts";

export interface SourceConnection {
  id: string;
  public_id: string;
  organization_id: string;
  provider: "tally" | "generic_webhook" | "internal_manual" | "builtin_form";
  external_source_id: string | null;
  mapping: Record<string, unknown>;
  settings: Record<string, unknown>;
  max_payload_bytes: number;
  secret_ref: string | null;
}

export interface SourceContext {
  connection: SourceConnection;
  request: Request;
  rawBody: Uint8Array;
  payload: Record<string, unknown>;
  secret: string | null;
  receivedAt: string;
}

export interface SourceAdapter {
  verify(context: SourceContext): Promise<void>;
  normalize(context: SourceContext): LeadIntakeV1;
}
