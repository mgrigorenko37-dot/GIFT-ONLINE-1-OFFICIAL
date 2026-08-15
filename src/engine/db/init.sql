CREATE TABLE IF NOT EXISTS te_balances (
  user_id VARCHAR(255) NOT NULL,
  currency VARCHAR(32) NOT NULL,
  available_balance NUMERIC NOT NULL DEFAULT 0,
  locked_balance NUMERIC NOT NULL DEFAULT 0,
  realized_pnl NUMERIC NOT NULL DEFAULT 0,
  total_fees NUMERIC NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, currency)
);

CREATE TABLE IF NOT EXISTS te_orders (
  order_id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  instrument_key VARCHAR(255) NOT NULL,
  side VARCHAR(32) NOT NULL,
  order_type VARCHAR(20) NOT NULL,
  qty NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  reduce_only BOOLEAN NOT NULL,
  position_effect VARCHAR(20) NOT NULL DEFAULT 'Open',
  rejection_reason TEXT,
  status VARCHAR(20) NOT NULL,
  executed_qty NUMERIC NOT NULL,
  remaining_qty NUMERIC NOT NULL,
  avg_fill_price NUMERIC NOT NULL,
  fee NUMERIC NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS te_positions (
  position_id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  instrument_key VARCHAR(255) NOT NULL,
  side VARCHAR(32) NOT NULL,
  qty NUMERIC NOT NULL,
  avg_entry_price NUMERIC NOT NULL,
  mark_price NUMERIC NOT NULL,
  unrealized_pnl NUMERIC NOT NULL,
  realized_pnl NUMERIC NOT NULL,
  status VARCHAR(20) NOT NULL,
  opened_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, instrument_key)
);

CREATE TABLE IF NOT EXISTS te_trades (
  trade_id VARCHAR(255) PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  instrument_key VARCHAR(255) NOT NULL,
  side VARCHAR(32) NOT NULL,
  qty NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  fee NUMERIC NOT NULL,
  realized_pnl NUMERIC NOT NULL,
  timestamp BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS te_outbox_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  locked_at BIGINT,
  published_at BIGINT
);
CREATE TABLE IF NOT EXISTS te_executions (
  execution_id VARCHAR(255) PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  instrument_key VARCHAR(255) NOT NULL,
  side VARCHAR(32) NOT NULL,
  requested_qty NUMERIC NOT NULL,
  fill_qty NUMERIC NOT NULL,
  fill_price NUMERIC NOT NULL,
  fee NUMERIC NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at BIGINT NOT NULL,
  processed_at BIGINT NOT NULL,
  source VARCHAR(50),
  external_execution_id VARCHAR(255)
);
CREATE UNIQUE INDEX IF NOT EXISTS te_executions_source_ext_idx ON te_executions(source, external_execution_id) WHERE source IS NOT NULL AND external_execution_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS te_funding_payments (
  funding_id VARCHAR(255) PRIMARY KEY,
  position_id VARCHAR(255) NOT NULL REFERENCES te_positions(position_id),
  user_id VARCHAR(255) NOT NULL,
  instrument_key VARCHAR(255) NOT NULL,
  currency VARCHAR(32) NOT NULL,
  side VARCHAR(32) NOT NULL,
  funding_rate NUMERIC NOT NULL,
  funding_interval VARCHAR(32) NOT NULL DEFAULT '8h',
  funding_timestamp BIGINT NOT NULL,
  mark_price NUMERIC NOT NULL,
  qty NUMERIC NOT NULL,
  notional NUMERIC NOT NULL,
  funding_amount NUMERIC NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSED',
  created_at BIGINT NOT NULL,
  processed_at BIGINT NOT NULL,
  error_reason TEXT,
  UNIQUE(position_id, instrument_key, currency, funding_interval, funding_timestamp)
);

CREATE TABLE IF NOT EXISTS te_funding_periods (
  instrument_key VARCHAR(255) NOT NULL,
  currency VARCHAR(32) NOT NULL,
  funding_interval VARCHAR(32) NOT NULL DEFAULT '8h',
  funding_timestamp BIGINT NOT NULL,
  funding_rate NUMERIC NOT NULL,
  mark_price NUMERIC NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (instrument_key, currency, funding_interval, funding_timestamp)
);
