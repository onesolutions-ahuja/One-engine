/** Upgrade-only migration; never imported by the payment engine or any provider runtime. */
export const REVOLUT_PAYMENT_DDL=`
CREATE TABLE IF NOT EXISTS md_revolut_checkout_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 credential_id uuid NOT NULL REFERENCES md_named_credentials(id),
 created_by uuid NOT NULL REFERENCES md_users(id),
 source_object text NOT NULL,
 source_record_id uuid NOT NULL,
 attempt_key uuid NOT NULL,
 revolut_order_id uuid NOT NULL,
 public_token text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency varchar(3) NOT NULL,
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','authorised','completed','failed','cancelled')),
 last_event text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,created_by,attempt_key),
 UNIQUE(tenant_id,revolut_order_id)
);
CREATE INDEX IF NOT EXISTS md_revolut_checkout_source
 ON md_revolut_checkout_orders(tenant_id,source_object,source_record_id);
`;

/** One-time-compatible, repeatable copy of checkout receipts from the old Revolut table.
 * The original table remains untouched for rollback and historic reconciliation. */
export const LEGACY_REVOLUT_PAYMENT_COPY=`
INSERT INTO md_payment_orders
 (id,tenant_id,provider,credential_id,created_by,source_object,source_record_id,
  attempt_key,provider_order_id,checkout_token,amount_minor,currency,status,
  last_event,created_at,updated_at)
SELECT id,tenant_id,'Revolut',credential_id,created_by,source_object,source_record_id,
 attempt_key,revolut_order_id::text,public_token,amount_minor,currency,status,
 last_event,created_at,updated_at
FROM md_revolut_checkout_orders
ON CONFLICT DO NOTHING;
`;
