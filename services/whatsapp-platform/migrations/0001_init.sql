-- Runs as the schema owner. The application connects as wa_app, which is subject to RLS.
DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'migration role must have BYPASSRLS: the tenant-resolution function runs as this role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wa_app') THEN
    CREATE ROLE wa_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

CREATE FUNCTION current_tenant_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')
$$;

CREATE TABLE platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ai_sending_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings DEFAULT VALUES;

CREATE TABLE tenants (
  id text PRIMARY KEY CHECK (id ~ '^tnt_[A-Za-z0-9]{8,64}$'),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  ai_sending_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_settings (
  tenant_id text PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  grace_minutes_open integer NOT NULL DEFAULT 2 CHECK (grace_minutes_open BETWEEN 0 AND 60),
  grace_minutes_closed integer NOT NULL DEFAULT 0 CHECK (grace_minutes_closed BETWEEN 0 AND 60),
  human_pause_hours integer NOT NULL DEFAULT 4 CHECK (human_pause_hours BETWEEN 0 AND 168),
  max_template_messages_per_customer_per_week integer NOT NULL DEFAULT 2
    CHECK (max_template_messages_per_customer_per_week >= 0),
  ai_disclosure_enabled boolean NOT NULL DEFAULT true,
  languages text[] NOT NULL DEFAULT ARRAY['en'],
  timezone text NOT NULL DEFAULT 'Europe/London',
  opening_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_messages_per_hour_limit integer NOT NULL DEFAULT 40 CHECK (customer_messages_per_hour_limit > 0),
  daily_token_budget integer NOT NULL DEFAULT 200000 CHECK (daily_token_budget >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- route A = coexistence, B = second number, C = number moved to the API
CREATE TABLE whatsapp_accounts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  waba_id text NOT NULL,
  phone_number_id text NOT NULL UNIQUE,
  display_phone_number text NOT NULL,
  connection_route text NOT NULL CHECK (connection_route IN ('A', 'B', 'C')),
  access_token_ciphertext bytea,
  access_token_key_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((access_token_ciphertext IS NULL) = (access_token_key_id IS NULL))
);

CREATE TABLE conversations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  whatsapp_account_id text NOT NULL,
  customer_identity text NOT NULL,
  crm_person_id text,
  state text NOT NULL DEFAULT 'AI_ACTIVE'
    CHECK (state IN ('AI_ACTIVE', 'HUMAN_ACTIVE', 'AWAITING_APPROVAL', 'CLOSED')),
  assigned_user_id text,
  channels text[] NOT NULL DEFAULT ARRAY['whatsapp'],
  last_message_at timestamptz,
  last_customer_message_at timestamptz,
  last_human_reply_at timestamptz,
  ai_paused_until timestamptz,
  claim_id text,
  claim_holder text,
  claim_latest_message_id text,
  claim_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, whatsapp_account_id) REFERENCES whatsapp_accounts (tenant_id, id),
  CHECK ((claim_id IS NULL) = (claim_expires_at IS NULL))
);
CREATE UNIQUE INDEX conversations_one_open_per_customer
  ON conversations (tenant_id, whatsapp_account_id, customer_identity)
  WHERE state <> 'CLOSED';

-- direction: inbound = customer, outbound = sent by us (AI or inbox), echo = owner replied from the Business app
CREATE TABLE messages (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  provider_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound', 'echo')),
  sender_type text NOT NULL CHECK (sender_type IN ('customer', 'ai', 'human', 'system')),
  sender_identity text NOT NULL,
  message_type text NOT NULL,
  body text,
  template jsonb,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'pending', 'sent', 'delivered', 'read', 'failed')),
  idempotency_key text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id),
  CHECK (direction <> 'inbound' OR provider_message_id IS NOT NULL)
);
CREATE UNIQUE INDEX messages_provider_id_unique
  ON messages (tenant_id, channel, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX messages_idempotency_key_unique
  ON messages (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX messages_conversation_received ON messages (tenant_id, conversation_id, received_at);

CREATE TABLE attachments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  message_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('image', 'audio', 'video', 'document', 'sticker')),
  provider_media_id text,
  storage_key text,
  mime_type text NOT NULL,
  size bigint CHECK (size >= 0),
  sha256 text,
  virus_scan_status text NOT NULL DEFAULT 'pending'
    CHECK (virus_scan_status IN ('pending', 'clean', 'infected', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messages (tenant_id, id)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  action text NOT NULL,
  target text,
  decision text NOT NULL CHECK (decision IN ('allowed', 'denied', 'error')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_tenant_time ON audit_log (tenant_id, occurred_at);

CREATE FUNCTION audit_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END
$$;
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

CREATE TABLE jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX jobs_due ON jobs (run_at) WHERE status IN ('queued', 'running');

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants', 'tenant_settings', 'whatsapp_accounts', 'conversations',
    'messages', 'attachments', 'audit_log', 'jobs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (%s = current_tenant_id()) WITH CHECK (%s = current_tenant_id())',
      table_name,
      CASE WHEN table_name = 'tenants' THEN 'id' ELSE 'tenant_id' END,
      CASE WHEN table_name = 'tenants' THEN 'id' ELSE 'tenant_id' END
    );
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO wa_app;
GRANT SELECT ON platform_settings TO wa_app;
GRANT SELECT ON tenants TO wa_app;
GRANT SELECT, UPDATE ON tenant_settings TO wa_app;
GRANT SELECT ON whatsapp_accounts TO wa_app;
GRANT SELECT, INSERT, UPDATE ON conversations, messages, attachments, jobs TO wa_app;
GRANT SELECT, INSERT ON audit_log TO wa_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO wa_app;

-- Inbound webhooks arrive before the tenant is known; this is the only pre-tenant lookup.
CREATE FUNCTION resolve_tenant_by_phone_number_id(p_phone_number_id text)
RETURNS TABLE (tenant_id text, whatsapp_account_id text, connection_route text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.tenant_id, a.id, a.connection_route
  FROM whatsapp_accounts a
  JOIN tenants t ON t.id = a.tenant_id
  WHERE a.phone_number_id = p_phone_number_id AND a.status = 'active' AND t.status = 'active'
$$;
REVOKE ALL ON FUNCTION resolve_tenant_by_phone_number_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_phone_number_id(text) TO wa_app;
