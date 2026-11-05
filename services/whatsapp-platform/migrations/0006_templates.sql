-- Approval status of each library template on each client's WhatsApp Business Account.
CREATE TABLE whatsapp_templates (
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  language text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'paused', 'disabled')),
  category text NOT NULL CHECK (category IN ('utility', 'marketing')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name, language)
);
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_templates
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT ON whatsapp_templates TO wa_app;

CREATE INDEX messages_templates_by_time ON messages (tenant_id, received_at) WHERE message_type = 'template';
