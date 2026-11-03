-- The service no longer runs an AI agent; automation providers drive it over REST and MCP.
DROP TABLE agent_turns, token_usage, pending_actions, offered_slots, bookings, pricebook_items, kb_entries;
DROP INDEX messages_templates_by_time;

ALTER TABLE tenant_settings
  DROP COLUMN max_template_messages_per_customer_per_week,
  DROP COLUMN ai_disclosure_enabled,
  DROP COLUMN languages,
  DROP COLUMN customer_messages_per_hour_limit,
  DROP COLUMN daily_token_budget,
  DROP COLUMN emergency_message,
  DROP COLUMN handoff_message;

-- Each client has its own templates; status follows Meta's message_template_status_update webhook.
ALTER TABLE whatsapp_templates
  ADD COLUMN body text NOT NULL DEFAULT '',
  ADD COLUMN parameters text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN quick_replies text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN provider_template_id text,
  ADD COLUMN last_event text;
GRANT INSERT, UPDATE ON whatsapp_templates TO wa_app;

-- Automation providers (n8n, external agents, ...) receive signed events at these URLs.
CREATE TABLE event_subscriptions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  url text NOT NULL,
  secret_ciphertext bytea NOT NULL,
  secret_key_id text NOT NULL,
  event_types text[] NOT NULL CHECK (cardinality(event_types) > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL
);
ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON event_subscriptions
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON event_subscriptions TO wa_app;

-- Template status webhooks name the WABA, not a phone number.
CREATE FUNCTION resolve_tenant_by_waba_id(p_waba_id text)
RETURNS TABLE (tenant_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT a.tenant_id
  FROM whatsapp_accounts a
  JOIN tenants t ON t.id = a.tenant_id
  WHERE a.waba_id = p_waba_id AND a.status = 'active' AND t.status = 'active'
$$;
REVOKE ALL ON FUNCTION resolve_tenant_by_waba_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_waba_id(text) TO wa_app;
