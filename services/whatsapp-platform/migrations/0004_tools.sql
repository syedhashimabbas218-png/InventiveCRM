CREATE TABLE kb_entries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kb_entries_search ON kb_entries USING gin (search);

-- Prices are integers in pence. The agent may only quote prices that appear here with approved = true.
CREATE TABLE pricebook_items (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_pence integer NOT NULL CHECK (price_pence >= 0),
  unit text NOT NULL DEFAULT 'each',
  approved boolean NOT NULL DEFAULT false,
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || description)) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pricebook_items_search ON pricebook_items USING gin (search);

-- Slots returned by availability.get. booking tools accept only these ids, so the agent cannot invent availability.
CREATE TABLE offered_slots (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  service_id text,
  offered_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
);

CREATE TABLE pending_actions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  tool text NOT NULL,
  params jsonb NOT NULL,
  summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('awaiting_customer', 'awaiting_staff', 'executed', 'declined', 'expired', 'failed')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_by_message_id text,
  result jsonb,
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
);

CREATE TABLE bookings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  crm_person_id text NOT NULL,
  calendar_booking_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, calendar_booking_id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['kb_entries', 'pricebook_items', 'offered_slots', 'pending_actions', 'bookings']
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

GRANT SELECT ON kb_entries, pricebook_items TO wa_app;
GRANT SELECT, INSERT, UPDATE ON offered_slots, pending_actions, bookings TO wa_app;
