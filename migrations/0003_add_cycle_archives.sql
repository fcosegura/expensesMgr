ALTER TABLE user_settings
ADD COLUMN active_cycle_end_date TEXT;

CREATE TABLE IF NOT EXISTS closed_cycles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cycle_start_date TEXT NOT NULL,
  cycle_end_date TEXT NOT NULL,
  label TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  real_closing_balance REAL NOT NULL,
  projected_closing_balance REAL NOT NULL,
  income_total REAL NOT NULL,
  real_expense_total REAL NOT NULL,
  projected_expense_total REAL NOT NULL,
  account_balances_json TEXT NOT NULL,
  incomes_json TEXT NOT NULL,
  expenses_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_closed_cycles_user_end
ON closed_cycles(user_id, cycle_end_date DESC);
