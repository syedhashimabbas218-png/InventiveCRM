-- Lists the values that would stop the unique indexes of Quotes & Invoices 0.6 (invoiceNumber, quoteNumber) and
-- Feedback 0.2 (sourceId) from being created, in every workspace schema of one Twenty database. Read-only.
-- Run it with psql (it needs \gexec); how to run it and fix what it finds: docs/duplicate-check.md.
\set ON_ERROR_STOP on
\pset pager off
\pset null ''

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- Give up rather than wait behind another session's lock: queries arriving after ours would queue too.
SET LOCAL lock_timeout = '5s';

\echo 'Result 1: rows checked per workspace. Result 2: every row whose value another row also has. Result 3: verdict.'

-- A read-only transaction refuses every CREATE, temporary objects included, so the per-schema queries are built
-- here as text and run by \gexec. Unique btree indexes ignore NULLs but count soft-deleted rows, and so does this.
WITH checks (label, table_name, column_name, order_column, detail_columns) AS (
  VALUES
    ('invoice number', '_invoice', 'invoiceNumber', 'issuedAt', ARRAY['kind', 'status', 'issuedAt', 'lastSentAt']),
    ('quote number', '_quote', 'quoteNumber', 'sentAt', ARRAY['status', 'sentAt', 'lastSentAt']),
    ('feedback sourceId', '_feedbackRequest', 'sourceId', NULL, ARRAY['source', 'status', 'sentAt', 'answeredAt'])
),
workspace_columns AS (
  SELECT table_schema, table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema LIKE 'workspace\_%'
),
targets AS (
  SELECT
    checks.label,
    target.table_schema,
    coalesce(
      workspace."displayName" || ' (' || workspace.subdomain || ')'
        || CASE WHEN workspace."deletedAt" IS NOT NULL THEN ', deleted workspace' ELSE '' END,
      '(no workspace row)'
    ) AS workspace_label,
    format(
      $sql$SELECT t.%1$I AS value, t.id, t."createdAt", t."deletedAt", %2$s AS details,
  count(*) OVER (PARTITION BY t.%1$I) AS copies,
  row_number() OVER (PARTITION BY t.%1$I ORDER BY %3$s t."createdAt", t.id) AS position
FROM %4$I.%5$I t WHERE t.%1$I IS NOT NULL$sql$,
      checks.column_name,
      coalesce(details.expression, 'NULL::text'),
      coalesce(ordering.expression, ''),
      target.table_schema,
      checks.table_name
    ) AS rows_sql
  FROM checks
  JOIN workspace_columns target ON target.table_name = checks.table_name AND target.column_name = checks.column_name
  LEFT JOIN core.workspace workspace ON workspace."databaseSchema" = target.table_schema
  -- Older app versions may lack a detail column; only the ones this schema has are shown.
  LEFT JOIN LATERAL (
    SELECT 'concat_ws('', '', ' || string_agg(
      CASE
        WHEN detail.data_type LIKE 'timestamp%'
          THEN format('%L || '' '' || to_char(t.%I AT TIME ZONE ''UTC'', ''YYYY-MM-DD HH24:MI'')', wanted.column_name, wanted.column_name)
        ELSE format('%L || '' '' || t.%I::text', wanted.column_name, wanted.column_name)
      END, ', ' ORDER BY wanted.position) || ')' AS expression
    FROM unnest(checks.detail_columns) WITH ORDINALITY AS wanted (column_name, position)
    JOIN workspace_columns detail
      ON detail.table_schema = target.table_schema AND detail.table_name = checks.table_name AND detail.column_name = wanted.column_name
  ) details ON true
  LEFT JOIN LATERAL (
    SELECT format('t.%I NULLS LAST,', sort_column.column_name) AS expression
    FROM workspace_columns sort_column
    WHERE sort_column.table_schema = target.table_schema AND sort_column.table_name = checks.table_name
      AND sort_column.column_name = checks.order_column
  ) ordering ON true
),
generated AS (
  SELECT
    string_agg(format(
      $sql$SELECT %L AS "check", %L AS workspace_schema, %L AS workspace, count(*) AS rows_with_value,
  count(*) FILTER (WHERE copies > 1 AND position = 1) AS duplicated_values,
  count(*) FILTER (WHERE copies > 1) AS rows_sharing_a_value
FROM (%s) numbered$sql$,
      label, table_schema, workspace_label, rows_sql), E'\nUNION ALL\n' ORDER BY label, table_schema) AS summary_sql,
    string_agg(format(
      $sql$SELECT %L AS "check", %L AS workspace_schema, %L AS workspace, quote_literal(value) AS value, copies, position, id,
  to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS created_utc,
  to_char("deletedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS deleted_utc, details
FROM (%s) numbered WHERE copies > 1$sql$,
      label, table_schema, workspace_label, rows_sql), E'\nUNION ALL\n' ORDER BY label, table_schema) AS duplicates_sql
  FROM targets
)
SELECT
  coalesce(summary_sql || E'\nORDER BY 1, 2', $sql$SELECT 'No workspace schema has these tables: nothing to check.' AS note$sql$),
  duplicates_sql || E'\nORDER BY 1, 2, 4, 6',
  coalesce(
    format(
      $sql$SELECT CASE WHEN sum(duplicated_values) = 0
  THEN 'OK: no duplicates in ' || count(*) || ' tables. The unique indexes can be created.'
  ELSE 'FIX FIRST: ' || sum(duplicated_values) || ' duplicated values in ' || count(*) FILTER (WHERE duplicated_values > 0)
    || ' of ' || count(*) || ' tables. See docs/duplicate-check.md.' END AS verdict
FROM (%s) summary$sql$,
      summary_sql),
    $sql$SELECT 'Nothing checked.' AS verdict$sql$)
FROM generated
\gexec

ROLLBACK;
