-- Fast-path dedupe of whole webhook bodies. Holds hashes only, no tenant data, so it has no RLS.
CREATE TABLE webhook_receipts (
  body_sha256 text PRIMARY KEY,
  received_at timestamptz NOT NULL
);
GRANT SELECT, INSERT ON webhook_receipts TO wa_app;

CREATE TABLE customer_contacts (
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_identity text NOT NULL,
  profile_name text,
  consent_at timestamptz,
  opted_out_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, customer_identity)
);
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_contacts
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON customer_contacts TO wa_app;

ALTER TABLE messages
  ADD COLUMN content jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN provider_sent_at timestamptz,
  ADD COLUMN reply_to_provider_message_id text,
  ADD COLUMN provider_error jsonb;

DROP FUNCTION resolve_tenant_by_phone_number_id(text);
CREATE FUNCTION resolve_tenant_by_phone_number_id(p_phone_number_id text)
RETURNS TABLE (tenant_id text, whatsapp_account_id text, waba_id text, connection_route text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.tenant_id, a.id, a.waba_id, a.connection_route
  FROM whatsapp_accounts a
  JOIN tenants t ON t.id = a.tenant_id
  WHERE a.phone_number_id = p_phone_number_id AND a.status = 'active' AND t.status = 'active'
$$;
REVOKE ALL ON FUNCTION resolve_tenant_by_phone_number_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_phone_number_id(text) TO wa_app;
