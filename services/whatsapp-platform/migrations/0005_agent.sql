ALTER TABLE tenant_settings
  ADD COLUMN emergency_message text,
  ADD COLUMN handoff_message text;

CREATE TABLE agent_turns (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  message_id text NOT NULL,
  outcome text NOT NULL,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  sent_message_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
);
CREATE INDEX agent_turns_conversation ON agent_turns (tenant_id, conversation_id);

CREATE TABLE token_usage (
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  budget_alert_sent boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, usage_date)
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['agent_turns', 'token_usage']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      table_name
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT ON agent_turns TO wa_app;
GRANT SELECT, INSERT, UPDATE ON token_usage TO wa_app;
