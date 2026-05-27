import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { buildDashboardSummary } from './domain/ledger'
import type {
  Account,
  AccountInput,
  AppData,
  ClosedCycle,
  ExpenseEntry,
  ExpenseInput,
  ExpenseTemplate,
  ExpenseTemplateInput,
  IncomeEntry,
  IncomeInput,
  UserSession,
  UserSettings,
} from './domain/types'
import { createRepository, getRuntimeMode } from './data/runtime'

const repository = createRepository()

const navItems = [
  { to: '/', label: 'Saldo', icon: 'wallet' as const },
  { to: '/gastos', label: 'Gastos', icon: 'receipt' as const },
  { to: '/historico', label: 'Historico', icon: 'chart' as const },
  { to: '/opciones', label: 'Opciones', icon: 'settings' as const },
]

const motionVariants = {
  initial: { opacity: 0, y: 10, filter: 'blur(10px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(8px)' },
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    ...(options ?? {}),
  }).format(new Date(`${date}T12:00:00`))
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function dateFromDueDay(dueDay: number, reference = new Date()) {
  const year = reference.getFullYear()
  const month = reference.getMonth()
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate()
  const day = Math.min(Math.max(1, Math.round(dueDay)), lastDayOfMonth)

  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function expenseNoteFromTemplate(template: ExpenseTemplate) {
  return `${template.name} - ${template.category}`
}

function getInitialAccount(): AccountInput {
  return {
    name: '',
    openingBalance: 0,
    color: '#7c3aed',
    isActive: true,
  }
}

function getInitialTemplate(): ExpenseTemplateInput {
  return {
    name: '',
    defaultAmount: 0,
    category: 'Hogar',
    dueDay: 1,
    isActive: true,
  }
}

function getInitialExpense(): ExpenseInput {
  return {
    type: 'variable',
    isProjected: false,
    amount: 0,
    movementDate: today(),
    note: '',
    category: 'Compras',
  }
}

function getMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Se produjo un error inesperado.'
}

function App() {
  const location = useLocation()
  const runtimeMode = getRuntimeMode()
  const [session, setSession] = useState<UserSession | null>(null)
  const [data, setData] = useState<AppData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const nextSession = await repository.getSession()
      setSession(nextSession)
      setErrorMessage(null)

      if (nextSession.isAuthenticated || nextSession.mode === 'qa') {
        const nextData = await repository.getData()
        setData(nextData)
      } else {
        setData(null)
      }
    } catch (error) {
      setErrorMessage(getMessage(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authError = params.get('auth_error')
    if (authError) {
      setErrorMessage(authError)
      window.history.replaceState({}, '', window.location.pathname)
    }

    const bootstrapId = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(bootstrapId)
  }, [])

  const summary = useMemo(() => (data ? buildDashboardSummary(data) : null), [data])

  async function runMutation(label: string, mutation: () => Promise<AppData>) {
    setBusyLabel(label)
    setErrorMessage(null)

    try {
      const nextData = await mutation()
      setData(nextData)
    } catch (error) {
      setErrorMessage(getMessage(error))
    } finally {
      setBusyLabel(null)
    }
  }

  async function handleSignIn() {
    setBusyLabel('Conectando')

    try {
      await repository.signIn()
    } catch (error) {
      setErrorMessage(getMessage(error))
      setBusyLabel(null)
    }
  }

  async function handleSignOut() {
    if (!session) {
      return
    }

    setBusyLabel(session.mode === 'qa' ? 'Recargando demo' : 'Cerrando sesion')

    try {
      if (session.mode === 'qa' && repository.resetQaData) {
        const nextData = await repository.resetQaData()
        setData(nextData)
        setBusyLabel(null)
        return
      }

      await repository.signOut()
      await loadData()
    } catch (error) {
      setErrorMessage(getMessage(error))
      setBusyLabel(null)
    }
  }

  if (loading && !session) {
    return <LoadingState />
  }

  if (!session && errorMessage) {
    return (
      <BootstrapErrorState
        message={errorMessage}
        onRetry={() => void loadData()}
      />
    )
  }

  if (runtimeMode === 'prod' && session && !session.isAuthenticated) {
    return (
      <AuthGate
        busyLabel={busyLabel}
        errorMessage={errorMessage}
        oauthRedirectUri={session.oauth?.redirectUri}
        onSignIn={handleSignIn}
      />
    )
  }

  if (!session || !data || !summary) {
    if (errorMessage) {
      return (
        <BootstrapErrorState
          message={errorMessage}
          onRetry={() => void loadData()}
        />
      )
    }

    return <LoadingState />
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-a"></div>
      <div className="ambient ambient-b"></div>

      <header className="topbar glass-card">
        <div>
          <span className="eyebrow">Expenses Manager</span>
          <h1>Controla tu saldo con una vista clara y viva.</h1>
          <p>
            Gestiona cuentas, ingresos, gastos fijos y variables con un flujo pensado
            para revisar tu ciclo en segundos.
          </p>
        </div>

        <div className="topbar-side">
          <div className="profile-chip glass-pill">
            <div className="avatar-ring">{session.user?.name?.slice(0, 1) ?? 'U'}</div>
            <div>
              <strong>{session.user?.name}</strong>
              <span>{session.mode === 'qa' ? 'Modo QA local' : session.user?.email}</span>
            </div>
          </div>

          <button type="button" className="ghost-button" onClick={() => void handleSignOut()}>
            {session.mode === 'qa' ? 'Recargar demo' : 'Salir'}
          </button>
        </div>
      </header>

      <main className="page-shell">
        {busyLabel ? <StatusBanner label={busyLabel} /> : null}
        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={motionVariants}
            transition={{ duration: 0.26, ease: 'easeOut' }}
          >
            <Routes location={location}>
              <Route
                path="/"
                element={
                  <SaldoPage
                    accounts={data.accounts}
                    incomes={data.incomes}
                    currency={data.settings.currency}
                    summary={summary}
                    onSaveAccount={(input) => void runMutation('Guardando cuenta', () => repository.upsertAccount(input))}
                    onAddIncome={(input) => void runMutation('Registrando ingreso', () => repository.addIncome(input))}
                  />
                }
              />
              <Route
                path="/gastos"
                element={
                  <GastosPage
                    accounts={data.accounts}
                    expenses={data.expenses}
                    expenseTemplates={data.expenseTemplates}
                    currency={data.settings.currency}
                    onSaveTemplate={(input) =>
                      void runMutation('Guardando gasto fijo', () => repository.upsertExpenseTemplate(input))
                    }
                    onSaveExpense={(input) =>
                      void runMutation('Guardando gasto', () => repository.upsertExpense(input))
                    }
                    onRealizeExpense={(expense) =>
                      void runMutation('Convirtiendo gasto proyectado', () =>
                        repository.upsertExpense({ ...expense, isProjected: false }),
                      )
                    }
                  />
                }
              />
              <Route
                path="/historico"
                element={
                  <HistoricoPage
                    currency={data.settings.currency}
                    summary={summary}
                    closedCycles={data.closedCycles}
                  />
                }
              />
              <Route
                path="/opciones"
                element={
                  <OpcionesPage
                    runtimeMode={session.mode}
                    settings={data.settings}
                    onSaveSettings={(input) =>
                      void runMutation('Guardando opciones', () => repository.updateSettings(input))
                    }
                    onResetQa={
                      repository.resetQaData
                        ? () => void runMutation('Restableciendo demo', () => repository.resetQaData!())
                        : undefined
                    }
                  />
                }
              />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="bottom-nav glass-card" aria-label="Secciones principales">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <AppIcon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="centered-screen">
      <div className="glass-card centered-card">
        <span className="eyebrow">Inicializando</span>
        <h2>Cargando tu espacio financiero</h2>
        <p>Preparando datos, cuentas y el panel historico.</p>
      </div>
    </div>
  )
}

function BootstrapErrorState(props: { message: string; onRetry: () => void }) {
  return (
    <div className="centered-screen">
      <div className="glass-card centered-card">
        <span className="eyebrow">No se pudo cargar</span>
        <h2>Hubo un problema al iniciar</h2>
        <p>{props.message}</p>
        <button type="button" className="primary-button" onClick={props.onRetry}>
          Reintentar
        </button>
      </div>
    </div>
  )
}

function AuthGate(props: {
  busyLabel: string | null
  errorMessage: string | null
  oauthRedirectUri?: string
  onSignIn: () => Promise<void>
}) {
  return (
    <div className="centered-screen">
      <div className="glass-card auth-card">
        <span className="eyebrow">Modo produccion</span>
        <h2>Accede con tu cuenta de Google</h2>
        <p>
          La app en Cloudflare separa los datos por usuario autenticado y guarda todo en
          D1. Si abres <code>/api/session</code> sin iniciar sesion, veras
          <code>isAuthenticated: false</code>; es normal hasta que entres con Google.
        </p>

        {props.errorMessage ? <ErrorBanner message={props.errorMessage} /> : null}

        {props.oauthRedirectUri ? (
          <p className="muted-text">
            En Google Cloud, el redirect URI autorizado debe ser:{' '}
            <code>{props.oauthRedirectUri}</code>
          </p>
        ) : null}

        <button
          type="button"
          className="primary-button"
          onClick={() => void props.onSignIn()}
          disabled={Boolean(props.busyLabel)}
        >
          {props.busyLabel ?? 'Continuar con Google'}
        </button>
      </div>
    </div>
  )
}

function StatusBanner(props: { label: string }) {
  return (
    <div className="status-banner glass-pill">
      <div className="status-dot"></div>
      <span>{props.label}</span>
    </div>
  )
}

function ErrorBanner(props: { message: string }) {
  return (
    <div className="error-banner glass-card">
      <strong>Atencion</strong>
      <span>{props.message}</span>
    </div>
  )
}

function SectionBlock(props: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="section-stack">
      <div className="section-heading">
        <span className="eyebrow">{props.eyebrow}</span>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </div>
      {props.children}
    </section>
  )
}

function SaldoPage(props: {
  accounts: Account[]
  incomes: IncomeEntry[]
  currency: string
  summary: ReturnType<typeof buildDashboardSummary>
  onSaveAccount: (input: AccountInput) => void
  onAddIncome: (input: IncomeInput) => void
}) {
  const [accountDraft, setAccountDraft] = useState<AccountInput>(getInitialAccount())
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
  const [isIncomeModalOpen, setIsIncomeModalOpen] = useState(false)
  const [incomeDraft, setIncomeDraft] = useState<IncomeInput>({
    accountId: props.accounts[0]?.id ?? '',
    amount: 0,
    movementDate: today(),
    note: '',
  })

  function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.onSaveAccount(accountDraft)
    setAccountDraft(getInitialAccount())
    setIsAccountModalOpen(false)
  }

  function submitIncome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.onAddIncome(incomeDraft)
    setIncomeDraft((current) => ({
      ...current,
      amount: 0,
      note: '',
      movementDate: today(),
    }))
    setIsIncomeModalOpen(false)
  }

  return (
    <div className="content-stack">
      <div className="hero-grid">
        <GlassMetric
          label="Saldo real"
          value={formatCurrency(props.summary.realBalance, props.currency)}
          helper={`${props.summary.activeCycle.label} · sin proyectados`}
        />
        <GlassMetric
          label="Saldo proyectado"
          value={formatCurrency(props.summary.projectedBalance, props.currency)}
          helper={`Impacto pendiente ${formatCurrency(props.summary.projectedExpenseImpact, props.currency)}`}
        />
        <GlassMetric
          label="Gastos proyectados"
          value={formatCurrency(props.summary.cycleProjectedExpense, props.currency)}
          helper={`Disponible real ${formatCurrency(props.summary.realAvailable, props.currency)} · proyectado ${formatCurrency(props.summary.projectedAvailable, props.currency)}`}
        />
      </div>

      <SectionBlock
        eyebrow="Cuentas"
        title="Saldo por cuenta"
        description="Ajusta tus cuentas activas y usa cada una como origen de ingresos o gastos."
      >
        <div className="content-stack">
          <div className="section-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setAccountDraft(getInitialAccount())
                setIsAccountModalOpen(true)
              }}
            >
              Nueva cuenta
            </button>
          </div>

          <div className="glass-card list-card">
            {props.summary.accountBalances.map((account) => (
              <button
                key={account.accountId}
                type="button"
                className="list-row"
                onClick={() =>
                  (() => {
                    setAccountDraft({
                      id: account.accountId,
                      name: account.accountName,
                      openingBalance: account.openingBalance,
                      color: account.color,
                      isActive: true,
                    })
                    setIsAccountModalOpen(true)
                  })()
                }
              >
                <div className="list-row-leading">
                  <span className="color-dot" style={{ background: account.color }}></span>
                  <div>
                    <strong>{account.accountName}</strong>
                    <span>
                      Ingresos {formatCurrency(account.incomeTotal, props.currency)} · Gastos reales{' '}
                      {formatCurrency(account.expenseTotal, props.currency)}
                    </span>
                  </div>
                </div>
                <strong>{formatCurrency(account.currentBalance, props.currency)}</strong>
              </button>
            ))}
          </div>
        </div>

        <Modal
          isOpen={isAccountModalOpen}
          title={accountDraft.id ? 'Editar cuenta' : 'Nueva cuenta'}
          onClose={() => setIsAccountModalOpen(false)}
        >
          <form className="form-card" onSubmit={submitAccount}>
            <div className="card-title-row">
              <h3>Datos de la cuenta</h3>
              {accountDraft.id ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setAccountDraft(getInitialAccount())
                    setIsAccountModalOpen(false)
                  }}
                >
                  Limpiar
                </button>
              ) : null}
            </div>
            <Field label="Nombre">
              <input
                value={accountDraft.name}
                onChange={(event) => setAccountDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ej. BBVA"
                required
              />
            </Field>
            <div className="inline-fields">
              <Field label="Saldo inicial">
                <input
                  type="number"
                  step="0.01"
                  value={accountDraft.openingBalance}
                  onChange={(event) =>
                    setAccountDraft((current) => ({
                      ...current,
                      openingBalance: Number(event.target.value),
                    }))
                  }
                  required
                />
              </Field>
              <Field label="Color">
                <input
                  type="color"
                  value={accountDraft.color}
                  onChange={(event) => setAccountDraft((current) => ({ ...current, color: event.target.value }))}
                />
              </Field>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={accountDraft.isActive}
                onChange={(event) =>
                  setAccountDraft((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
              <span>Cuenta activa</span>
            </label>
            <button type="submit" className="primary-button">
              Guardar cuenta
            </button>
          </form>
        </Modal>
      </SectionBlock>

      <SectionBlock
        eyebrow="Ingresos"
        title="Registrar movimiento"
        description="Cada ingreso se vincula a una cuenta y alimenta el saldo total y el historico."
      >
        <div className="content-stack">
          <div className="section-actions">
            <button type="button" className="primary-button" onClick={() => setIsIncomeModalOpen(true)}>
              Nuevo ingreso
            </button>
          </div>
          <div className="glass-card list-card">
            <div className="card-title-row">
              <h3>Ultimos ingresos</h3>
              <span className="muted-text">{props.incomes.length} registros</span>
            </div>
            {props.incomes.slice(0, 6).map((income) => {
              const account = props.accounts.find((entry) => entry.id === income.accountId)
              return (
                <div key={income.id} className="list-row static-row">
                  <div>
                    <strong>{income.note || 'Ingreso'}</strong>
                    <span>
                      {account?.name ?? 'Cuenta'} · {formatDate(income.movementDate)}
                    </span>
                  </div>
                  <strong>{formatCurrency(income.amount, props.currency)}</strong>
                </div>
              )
            })}
          </div>
        </div>

        <Modal isOpen={isIncomeModalOpen} title="Nuevo ingreso" onClose={() => setIsIncomeModalOpen(false)}>
          <form className="form-card" onSubmit={submitIncome}>
            <Field label="Cuenta">
              <select
                value={incomeDraft.accountId}
                onChange={(event) =>
                  setIncomeDraft((current) => ({ ...current, accountId: event.target.value }))
                }
                required
              >
                <option value="" disabled>
                  Selecciona una cuenta
                </option>
                {props.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="inline-fields">
              <Field label="Importe">
                <input
                  type="number"
                  step="0.01"
                  value={incomeDraft.amount}
                  onChange={(event) =>
                    setIncomeDraft((current) => ({ ...current, amount: Number(event.target.value) }))
                  }
                  required
                />
              </Field>
              <Field label="Fecha">
                <input
                  type="date"
                  value={incomeDraft.movementDate}
                  onChange={(event) =>
                    setIncomeDraft((current) => ({ ...current, movementDate: event.target.value }))
                  }
                  required
                />
              </Field>
            </div>
            <Field label="Concepto">
              <input
                value={incomeDraft.note}
                onChange={(event) => setIncomeDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder="Nomina, transferencia..."
              />
            </Field>
            <button type="submit" className="primary-button">
              Anadir ingreso
            </button>
          </form>
        </Modal>
      </SectionBlock>
    </div>
  )
}

function GastosPage(props: {
  accounts: Account[]
  expenses: ExpenseEntry[]
  expenseTemplates: ExpenseTemplate[]
  currency: string
  onSaveTemplate: (input: ExpenseTemplateInput) => void
  onSaveExpense: (input: ExpenseInput) => void
  onRealizeExpense: (input: ExpenseInput) => void
}) {
  const [templateDraft, setTemplateDraft] = useState<ExpenseTemplateInput>(getInitialTemplate())
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false)
  const [expenseDraft, setExpenseDraft] = useState<ExpenseInput>({
    ...getInitialExpense(),
    accountId: props.accounts[0]?.id,
  })

  function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.onSaveTemplate(templateDraft)
    setTemplateDraft(getInitialTemplate())
    setIsTemplateModalOpen(false)
  }

  function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.onSaveExpense(expenseDraft)
    setExpenseDraft({
      ...getInitialExpense(),
      accountId: props.accounts[0]?.id,
    })
    setIsExpenseModalOpen(false)
  }

  return (
    <div className="content-stack">
      <SectionBlock
        eyebrow="Gastos fijos"
        title="Plantillas por periodo"
        description="Define pagos recurrentes como plantillas y registra el movimiento real cuando ocurra."
      >
        <div className="content-stack">
          <div className="section-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setTemplateDraft(getInitialTemplate())
                setIsTemplateModalOpen(true)
              }}
            >
              Nueva plantilla
            </button>
          </div>

          <div className="glass-card list-card">
            {props.expenseTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="list-row"
                onClick={() => {
                  setTemplateDraft(template)
                  setIsTemplateModalOpen(true)
                }}
              >
                <div>
                  <strong>{template.name}</strong>
                  <span>
                    {template.category} · Dia {template.dueDay}
                  </span>
                </div>
                <strong>{formatCurrency(template.defaultAmount, props.currency)}</strong>
              </button>
            ))}
          </div>
        </div>

        <Modal
          isOpen={isTemplateModalOpen}
          title={templateDraft.id ? 'Editar plantilla' : 'Nueva plantilla fija'}
          onClose={() => setIsTemplateModalOpen(false)}
        >
          <form className="form-card" onSubmit={submitTemplate}>
            <div className="card-title-row">
              <h3>Datos de plantilla</h3>
              {templateDraft.id ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setTemplateDraft(getInitialTemplate())
                    setIsTemplateModalOpen(false)
                  }}
                >
                  Limpiar
                </button>
              ) : null}
            </div>
            <Field label="Nombre">
              <input
                value={templateDraft.name}
                onChange={(event) => setTemplateDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Alquiler"
                required
              />
            </Field>
            <div className="inline-fields">
              <Field label="Importe previsto">
                <input
                  type="number"
                  step="0.01"
                  value={templateDraft.defaultAmount}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({
                      ...current,
                      defaultAmount: Number(event.target.value),
                    }))
                  }
                  required
                />
              </Field>
              <Field label="Dia de cargo">
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={templateDraft.dueDay}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({ ...current, dueDay: Number(event.target.value) }))
                  }
                  required
                />
              </Field>
            </div>
            <Field label="Categoria">
              <input
                value={templateDraft.category}
                onChange={(event) =>
                  setTemplateDraft((current) => ({ ...current, category: event.target.value }))
                }
                required
              />
            </Field>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={templateDraft.isActive}
                onChange={(event) =>
                  setTemplateDraft((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
              <span>Plantilla activa</span>
            </label>
            <button type="submit" className="primary-button">
              Guardar plantilla
            </button>
          </form>
        </Modal>
      </SectionBlock>

      <SectionBlock
        eyebrow="Movimientos"
        title="Registrar gasto real o proyectado"
        description="Apunta gastos variables o fijos, y marca los proyectados para que afecten solo al saldo estimado."
      >
        <div className="content-stack">
          <div className="section-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setExpenseDraft({
                  ...getInitialExpense(),
                  accountId: props.accounts[0]?.id,
                })
                setIsExpenseModalOpen(true)
              }}
            >
              Nuevo gasto
            </button>
          </div>
          <div className="glass-card list-card">
            <div className="card-title-row">
              <h3>Ultimos gastos</h3>
              <span className="muted-text">{props.expenses.length} registros</span>
            </div>
            {props.expenses.slice(0, 8).map((expense) => (
              <div
                key={expense.id}
                className={`expense-row ${expense.isProjected ? 'projected' : ''}`}
              >
                <button
                  type="button"
                  className="list-row expense-main-button"
                  onClick={() => {
                    setExpenseDraft(expense)
                    setIsExpenseModalOpen(true)
                  }}
                >
                  <div>
                    <strong>{expense.note || expense.category}</strong>
                    <span>
                      {expense.type === 'fixed' ? 'Fijo' : 'Variable'} · {formatDate(expense.movementDate)}
                    </span>
                  </div>
                  <strong>{formatCurrency(expense.amount, props.currency)}</strong>
                </button>

                <div className="expense-row-actions">
                  {expense.isProjected ? (
                    <>
                      <span className="projection-badge">Proyectado</span>
                      <button
                        type="button"
                        className="ghost-button action-button"
                        onClick={() => props.onRealizeExpense(expense)}
                      >
                        Hacer real
                      </button>
                    </>
                  ) : (
                    <span className="projection-badge real">Real</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Modal
          isOpen={isExpenseModalOpen}
          title={expenseDraft.id ? 'Editar gasto' : 'Nuevo gasto'}
          onClose={() => setIsExpenseModalOpen(false)}
        >
          <form className="form-card" onSubmit={submitExpense}>
            <div className="segmented-control" role="tablist" aria-label="Tipo de gasto">
              <button
                type="button"
                className={expenseDraft.type === 'variable' ? 'active' : ''}
                onClick={() => setExpenseDraft((current) => ({ ...current, type: 'variable', templateId: undefined }))}
              >
                Variable
              </button>
              <button
                type="button"
                className={expenseDraft.type === 'fixed' ? 'active' : ''}
                onClick={() => setExpenseDraft((current) => ({ ...current, type: 'fixed' }))}
              >
                Fijo
              </button>
            </div>

            {expenseDraft.type === 'fixed' ? (
              <Field label="Plantilla">
                <select
                  value={expenseDraft.templateId ?? ''}
                  onChange={(event) => {
                    const template = props.expenseTemplates.find((item) => item.id === event.target.value)
                    setExpenseDraft((current) => ({
                      ...current,
                      templateId: event.target.value,
                      amount: template ? template.defaultAmount : current.amount,
                      category: template ? template.category : current.category,
                      movementDate: template ? dateFromDueDay(template.dueDay) : current.movementDate,
                      note: template ? expenseNoteFromTemplate(template) : current.note,
                    }))
                  }}
                  required
                >
                  <option value="" disabled>
                    Selecciona una plantilla
                  </option>
                  {props.expenseTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <div className="inline-fields">
              <Field label="Cuenta">
                <select
                  value={expenseDraft.accountId ?? ''}
                  onChange={(event) =>
                    setExpenseDraft((current) => ({ ...current, accountId: event.target.value }))
                  }
                >
                  <option value="">Sin cuenta concreta</option>
                  {props.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha">
                <input
                  type="date"
                  value={expenseDraft.movementDate}
                  onChange={(event) =>
                    setExpenseDraft((current) => ({ ...current, movementDate: event.target.value }))
                  }
                  required
                />
              </Field>
            </div>

            <div className="inline-fields">
              <Field label="Importe">
                <input
                  type="number"
                  step="0.01"
                  value={expenseDraft.amount}
                  onChange={(event) =>
                    setExpenseDraft((current) => ({ ...current, amount: Number(event.target.value) }))
                  }
                  required
                />
              </Field>
              <Field label="Categoria">
                <input
                  value={expenseDraft.category}
                  onChange={(event) =>
                    setExpenseDraft((current) => ({ ...current, category: event.target.value }))
                  }
                  required
                />
              </Field>
            </div>

            <Field label="Detalle">
              <input
                value={expenseDraft.note}
                onChange={(event) => setExpenseDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder="Supermercado, suscripcion..."
              />
            </Field>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={expenseDraft.isProjected}
                onChange={(event) =>
                  setExpenseDraft((current) => ({ ...current, isProjected: event.target.checked }))
                }
              />
              <span>Marcar como gasto proyectado</span>
            </label>
            <button type="submit" className="primary-button">
              Guardar gasto
            </button>
          </form>
        </Modal>
      </SectionBlock>
    </div>
  )
}

function HistoricoPage(props: {
  currency: string
  summary: ReturnType<typeof buildDashboardSummary>
  closedCycles: ClosedCycle[]
}) {
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null)
  const selectedCycle =
    props.closedCycles.find((cycle) => cycle.id === selectedCycleId) ?? props.closedCycles[0] ?? null

  return (
    <div className="content-stack">
      <SectionBlock
        eyebrow="Grafica"
        title="Evolucion mensual del saldo"
        description="Una vista agregada del saldo total al cierre de cada ciclo para ver tendencias."
      >
        <div className="glass-card chart-card">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={props.summary.monthlyHistory}>
              <defs>
                <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(value) =>
                  typeof value === 'number' ? formatCurrency(value, props.currency) : ''
                }
                contentStyle={{
                  borderRadius: 18,
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(14, 17, 30, 0.84)',
                  backdropFilter: 'blur(24px)',
                }}
              />
              <Area type="monotone" dataKey="balance" stroke="#c4b5fd" strokeWidth={3} fill="url(#balanceFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SectionBlock>

      <SectionBlock
        eyebrow="Ciclo activo"
        title="Como se mueve tu periodo"
        description="Balance del ciclo actual con ingresos y egresos ordenados por fecha."
      >
        <div className="panel-grid">
          <div className="glass-card chart-card compact-chart">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={props.summary.monthlyHistory.slice(-4)}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis hide />
                <Tooltip
                  formatter={(value) =>
                    typeof value === 'number' ? formatCurrency(value, props.currency) : ''
                  }
                  contentStyle={{
                    borderRadius: 18,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(14, 17, 30, 0.84)',
                    backdropFilter: 'blur(24px)',
                  }}
                />
                <Bar dataKey="income" stackId="period" fill="#22c55e" radius={[10, 10, 0, 0]} />
                <Bar dataKey="expense" stackId="period" fill="#fb7185" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card list-card">
            <div className="card-title-row">
              <h3>Timeline del periodo</h3>
              <span className="muted-text">{props.summary.activeCycle.label}</span>
            </div>
            {props.summary.currentTimeline.map((entry) => (
              <div key={entry.id} className="timeline-row">
                <div className={`timeline-icon ${entry.kind}`}>
                  <AppIcon name={entry.kind === 'income' ? 'arrow-up' : 'arrow-down'} />
                </div>
                <div className="timeline-copy">
                  <strong>{entry.title}</strong>
                  <span>
                    {entry.subtitle} · {formatDate(entry.date, { year: 'numeric' })}
                  </span>
                </div>
                <strong className={entry.kind === 'income' ? 'positive' : 'negative'}>
                  {entry.kind === 'income' ? '+' : '-'}
                  {formatCurrency(entry.amount, props.currency)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </SectionBlock>

      <SectionBlock
        eyebrow="Ciclos cerrados"
        title="Historico de ciclos"
        description="Cada vez que el ciclo cambia, el periodo anterior se archiva aqui y Saldo/Gastos arrancan limpios con el saldo arrastrado."
      >
        <div className="panel-grid cycle-history-grid">
          <div className="glass-card list-card">
            <div className="card-title-row">
              <h3>Ciclos archivados</h3>
              <span className="muted-text">{props.closedCycles.length} cerrados</span>
            </div>

            {props.closedCycles.length === 0 ? (
              <div className="empty-state-block">
                <strong>Aun no hay ciclos cerrados</strong>
                <span>Cuando el periodo cambie, se guardara aqui su resumen y sus movimientos.</span>
              </div>
            ) : (
              props.closedCycles.map((cycle) => (
                <button
                  key={cycle.id}
                  type="button"
                  className={`closed-cycle-button ${selectedCycle?.id === cycle.id ? 'active' : ''}`}
                  onClick={() => setSelectedCycleId(cycle.id)}
                >
                  <div>
                    <strong>{cycle.label}</strong>
                    <span>
                      Ingresos {formatCurrency(cycle.incomeTotal, props.currency)} · Gastos reales{' '}
                      {formatCurrency(cycle.realExpenseTotal, props.currency)}
                    </span>
                  </div>
                  <strong>{formatCurrency(cycle.realClosingBalance, props.currency)}</strong>
                </button>
              ))
            )}
          </div>

          <div className="glass-card list-card">
            {selectedCycle ? (
              <>
                <div className="card-title-row">
                  <h3>{selectedCycle.label}</h3>
                  <span className="muted-text">
                    Cerrado el {formatDate(selectedCycle.closedAt.slice(0, 10), { year: 'numeric' })}
                  </span>
                </div>

                <div className="hero-grid compact-metrics">
                  <GlassMetric
                    label="Saldo real"
                    value={formatCurrency(selectedCycle.realClosingBalance, props.currency)}
                    helper="Saldo arrastrado al nuevo ciclo"
                  />
                  <GlassMetric
                    label="Saldo proyectado"
                    value={formatCurrency(selectedCycle.projectedClosingBalance, props.currency)}
                    helper={`Proyecciones ${formatCurrency(selectedCycle.projectedExpenseTotal, props.currency)}`}
                  />
                </div>

                <div className="archived-detail-grid">
                  <div>
                    <div className="card-title-row">
                      <h3>Ingresos</h3>
                      <span className="muted-text">{selectedCycle.incomes.length}</span>
                    </div>
                    {selectedCycle.incomes.length === 0 ? (
                      <div className="empty-inline">Sin ingresos registrados.</div>
                    ) : (
                      selectedCycle.incomes.map((income) => (
                        <div key={income.id} className="timeline-row">
                          <div className="timeline-icon income">
                            <AppIcon name="arrow-up" />
                          </div>
                          <div className="timeline-copy">
                            <strong>{income.note || 'Ingreso'}</strong>
                            <span>{formatDate(income.movementDate, { year: 'numeric' })}</span>
                          </div>
                          <strong className="positive">{formatCurrency(income.amount, props.currency)}</strong>
                        </div>
                      ))
                    )}
                  </div>

                  <div>
                    <div className="card-title-row">
                      <h3>Gastos</h3>
                      <span className="muted-text">{selectedCycle.expenses.length}</span>
                    </div>
                    {selectedCycle.expenses.length === 0 ? (
                      <div className="empty-inline">Sin gastos registrados.</div>
                    ) : (
                      selectedCycle.expenses.map((expense) => (
                        <div key={expense.id} className="timeline-row">
                          <div className={`timeline-icon ${expense.isProjected ? 'projected' : 'expense'}`}>
                            <AppIcon name="arrow-down" />
                          </div>
                          <div className="timeline-copy">
                            <strong>{expense.note || expense.category}</strong>
                            <span>
                              {expense.isProjected ? 'Proyectado' : 'Real'} ·{' '}
                              {formatDate(expense.movementDate, { year: 'numeric' })}
                            </span>
                          </div>
                          <strong className={expense.isProjected ? 'projected-text' : 'negative'}>
                            {formatCurrency(expense.amount, props.currency)}
                          </strong>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state-block">
                <strong>No hay detalle disponible</strong>
                <span>El primer cierre de ciclo aparecera aqui automaticamente.</span>
              </div>
            )}
          </div>
        </div>
      </SectionBlock>
    </div>
  )
}

function OpcionesPage(props: {
  runtimeMode: UserSession['mode']
  settings: UserSettings
  onSaveSettings: (settings: UserSettings) => void
  onResetQa?: () => void
}) {
  const [settingsDraft, setSettingsDraft] = useState<UserSettings>(props.settings)

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.onSaveSettings(settingsDraft)
  }

  return (
    <div className="content-stack">
      <SectionBlock
        eyebrow="Reglas"
        title="Fechas de corte del ciclo"
        description="Define a que dia pertenece cada periodo para calcular historico y disponibilidad."
      >
        <div className="panel-grid">
          <form className="glass-card form-card" onSubmit={submitSettings}>
            <div className="inline-fields">
              <Field label="Dia de corte">
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={settingsDraft.cutoffDay}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      cutoffDay: Number(event.target.value),
                    }))
                  }
                  required
                />
              </Field>
              <Field label="Moneda">
                <select
                  value={settingsDraft.currency}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      currency: event.target.value,
                    }))
                  }
                >
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="MXN">MXN</option>
                </select>
              </Field>
            </div>
            <Field label="Zona horaria">
              <select
                value={settingsDraft.timezone}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    timezone: event.target.value,
                  }))
                }
              >
                <option value="Europe/Madrid">Europe/Madrid</option>
                <option value="America/Mexico_City">America/Mexico_City</option>
                <option value="UTC">UTC</option>
              </select>
            </Field>
            <button type="submit" className="primary-button">
              Guardar opciones
            </button>
          </form>

          <div className="glass-card list-card">
            <div className="card-title-row">
              <h3>Resumen de funcionamiento</h3>
              <span className="muted-text">{props.runtimeMode === 'qa' ? 'Local' : 'Cloudflare'}</span>
            </div>
            <div className="summary-row">
              <strong>Ciclo actual</strong>
              <span>
                Del dia {props.settings.cutoffDay === 31 ? 1 : props.settings.cutoffDay + 1} al dia {props.settings.cutoffDay}
              </span>
            </div>
            <div className="summary-row">
              <strong>Persistencia</strong>
              <span>{props.runtimeMode === 'qa' ? 'localStorage con seeds editables' : 'D1 por usuario autenticado'}</span>
            </div>
            <div className="summary-row">
              <strong>Sesion</strong>
              <span>{props.runtimeMode === 'qa' ? 'Mock local para pruebas' : 'Google OAuth sobre Cloudflare'}</span>
            </div>

            {props.onResetQa ? (
              <button type="button" className="ghost-button wide-button" onClick={props.onResetQa}>
                Restablecer dataset QA
              </button>
            ) : null}
          </div>
        </div>
      </SectionBlock>
    </div>
  )
}

function GlassMetric(props: { label: string; value: string; helper: string }) {
  return (
    <div className="glass-card metric-card">
      <span className="metric-label">{props.label}</span>
      <strong>{props.value}</strong>
      <span className="metric-helper">{props.helper}</span>
    </div>
  )
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  )
}

function Modal(props: {
  isOpen: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!props.isOpen) {
      return
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [props.isOpen, props.onClose])

  if (!props.isOpen) {
    return null
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <div
        className="glass-card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="card-title-row">
          <h3>{props.title}</h3>
          <button type="button" className="text-button" onClick={props.onClose}>
            Cerrar
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

function AppIcon(props: {
  name: 'wallet' | 'receipt' | 'chart' | 'settings' | 'arrow-up' | 'arrow-down'
}) {
  const path = {
    wallet: 'M4 7.5a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 18 7.5v7A2.5 2.5 0 0 1 15.5 17h-9A2.5 2.5 0 0 1 4 14.5v-7Zm10.5 1a1 1 0 1 0 0 2h2v-2h-2Zm-8-5.5h7.25',
    receipt: 'M6 4.5h12v13l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2v-13Zm3 4h6m-6 3h6',
    chart: 'M5 16.5h14M7.5 14V10m4 4V7m4 7V9',
    settings:
      'M12 8.25A3.75 3.75 0 1 1 12 15.75A3.75 3.75 0 0 1 12 8.25Zm0-4.25v2m0 12v2m8-8h-2M6 12H4m12.243 5.657-1.414-1.414M7.17 7.17 5.757 5.757m10.486 0L14.83 7.17M7.17 16.83l-1.414 1.414',
    'arrow-up': 'M12 18V6m0 0-4 4m4-4 4 4',
    'arrow-down': 'M12 6v12m0 0-4-4m4 4 4-4',
  }[props.name]

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default App
