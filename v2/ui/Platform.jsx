import React, { useCallback, useEffect, useRef, useState } from "react";
import "./platform.css";
const money = (cents) =>
  cents === null || !Number.isFinite(cents)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);
function Status({ value }) {
  return <span className={`tag ${value}`}>{value.replaceAll("_", " ")}</span>;
}
function Table({ headers, children, empty }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td colSpan={headers.length}>No records yet.</td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}
const workspaces = {
  investment: ["Investment workspace", "Orders & investment decisions"],
  operations: ["Operations console", "Settlement & reconciliation"],
  client: ["Client portal", "Portfolio & reporting"],
};
export default function Platform({ apiBase = "" }) {
  const [auth, setAuth] = useState(null),
    [accountId, setAccountId] = useState(""),
    [view, setView] = useState("client"),
    [state, setState] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [pending, setPending] = useState(null),
    [registerMode, setRegisterMode] = useState(false);
  const context = useRef({ auth: null, accountId: "" });
  context.current = { auth, accountId };
  const request = useCallback(
    async (path, options = {}) => {
      const r = await fetch(apiBase + path, {
        ...options,
        credentials: "include",
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      });
      const data = await r.json();
      if (!r.ok) {
        const e = new Error(data.error || "Request failed");
        e.status = r.status;
        throw e;
      }
      return data;
    },
    [apiBase]
  );
  const [demoAvailable, setDemoAvailable] = useState(false);
  useEffect(() => {
    request("/api/config")
      .then((data) => setDemoAvailable(data.demoEnabled))
      .catch(() => {});
  }, [request]);
  async function startDemo() {
    setBusy(true);
    setError("");
    try {
      accept(
        await request("/api/demo", { method: "POST", body: JSON.stringify({}) })
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const accept = useCallback((data) => {
    setAuth(data);
    const saved = sessionStorage.getItem("investnexus-account");
    const account =
      data.accounts.find((a) => a.id === saved) || data.accounts[0];
    setAccountId(account?.id || "");
    setView(
      account?.roles.includes("investment")
        ? "investment"
        : account?.roles.includes("operations")
        ? "operations"
        : "client"
    );
    setState(null);
    setPending(null);
  }, []);
  useEffect(() => {
    let active = true;
    request("/api/auth/me")
      .then((data) => {
        if (active) accept(data);
      })
      .catch((e) => {
        if (active && e.status !== 401) setError(e.message);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [request, accept]);
  const load = useCallback(async () => {
    const current = context.current;
    const result = await request("/api/state?accountId=" + current.accountId);
    if (
      context.current.accountId === current.accountId &&
      context.current.auth?.user.id === current.auth?.user.id
    )
      setState(result);
  }, [request]);
  useEffect(() => {
    if (!auth || !accountId) return;
    sessionStorage.setItem("investnexus-account", accountId);
    let active = true;
    setState(null);
    const refresh = () =>
      load().catch((e) => {
        if (!active) return;
        if (e.status === 401) {
          setAuth(null);
          setState(null);
        }
        setError(e.message);
      });
    refresh();
    const events = new EventSource(
      apiBase + "/api/events?accountId=" + accountId,
      { withCredentials: true }
    );
    events.onmessage = refresh;
    // Poll as a fallback if SSE reconnects or a listener is temporarily unavailable.
    const timer = setInterval(refresh, 20000);
    return () => {
      active = false;
      events.close();
      clearInterval(timer);
    };
  }, [auth, accountId, apiBase, load]);
  async function loginSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const data = await request(
        "/api/auth/" + (registerMode ? "register" : "login"),
        {
          method: "POST",
          body: JSON.stringify({
            email: f.get("email"),
            password: f.get("password"),
            userName: f.get("name"),
          }),
        }
      );
      accept(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await request("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": auth.csrf },
      });
      setAuth(null);
      setState(null);
      setPending(null);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submitCommand(action, data, retry) {
    const mutation = retry || {
      action,
      data,
      key: crypto.randomUUID(),
      accountId,
    };
    setBusy(true);
    setError("");
    try {
      await request("/api/command?accountId=" + mutation.accountId, {
        method: "POST",
        headers: { "X-CSRF-Token": auth.csrf, "Idempotency-Key": mutation.key },
        body: JSON.stringify({ action: mutation.action, data: mutation.data }),
      });
      setPending(null);
      await load();
    } catch (e) {
      if (!e.status || e.status >= 500) setPending(mutation);
      else setPending(null);
      if (e.status === 401) {
        setAuth(null);
        setState(null);
      }
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const cmd = (action, data = {}) => submitCommand(action, data);
  async function exportReport() {
    try {
      const report = await request(
        "/api/report?scope=daily&accountId=" + accountId
      );
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        })
      );
      a.download = "investnexus-report.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e.message);
    }
  }
  if (!ready)
    return (
      <div className="nexus">
        <div className="login">
          <h1>InvestNexus</h1>
          <p>Restoring your session…</p>
        </div>
      </div>
    );
  if (!auth)
    return (
      <div className="nexus">
        <div className="login">
          <div className="eyebrow">INVESTNEXUS</div>
          <h1>
            Investment management,
            <br />
            from decision to report.
          </h1>
          <p>Sign in to your account workspace.</p>
          {error && (
            <div role="alert" className="notice">
              {error}
            </div>
          )}
          {demoAvailable && (
            <div className="demo-entry">
              <button className="primary" onClick={startDemo} disabled={busy}>
                Start private demo →
              </button>
              <p className="muted">
                Your own $100,000 sandbox. Switch between Investment, Operations
                and Client to complete the workflow. No real trades.
              </p>
            </div>
          )}
          <form onSubmit={loginSubmit}>
            {registerMode && (
              <label>
                Name
                <input
                  name="name"
                  autoComplete="name"
                  maxLength="80"
                  required
                />
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  registerMode ? "new-password" : "current-password"
                }
                minLength={registerMode ? 12 : undefined}
                maxLength="128"
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : registerMode
                ? "Create account"
                : "Sign in →"}
            </button>
          </form>
          {!demoAvailable && (
            <button
              className="link-button"
              disabled={busy}
              onClick={() => {
                setRegisterMode(!registerMode);
                setError("");
              }}
            >
              {registerMode
                ? "Already registered? Sign in"
                : "New here? Create an independent account"}
            </button>
          )}
          <p className="muted">
            Simulation environment · No real broker transactions.
          </p>
        </div>
      </div>
    );
  const account = auth.accounts.find((a) => a.id === accountId),
    roles = account?.roles || [],
    p = state?.portfolio;
  return (
    <div className="nexus">
      <aside>
        <div className="brand">
          ◈ InvestNexus<small>INVESTMENT MANAGEMENT</small>
        </div>
        <div className="label">WORKSPACES</div>
        <nav>
          {Object.entries(workspaces)
            .filter(([role]) => roles.includes(role))
            .map(([role, t]) => (
              <button
                className={view === role ? "active" : ""}
                key={role}
                onClick={() => setView(role)}
              >
                {t[0]}
              </button>
            ))}
        </nav>
        <div className="aside-bottom">
          <span className="dot" /> Connected account
          <br />
          <small>Simulated execution · USD</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <strong>{auth.user.userName}</strong>
            <small>{auth.user.email}</small>
          </div>
          <div className="row">
            <label className="account-select">
              Account
              <select
                value={accountId}
                disabled={busy || !!pending}
                onChange={(e) => {
                  const a = auth.accounts.find((x) => x.id === e.target.value);
                  setAccountId(a.id);
                  setView(
                    a.roles.includes("investment")
                      ? "investment"
                      : a.roles.includes("operations")
                      ? "operations"
                      : "client"
                  );
                }}
              >
                {auth.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={logout} disabled={busy}>
              Sign out
            </button>
          </div>
        </header>
        {error && (
          <div className="notice" role="alert">
            {error}
            {pending && (
              <>
                <p>
                  The result is uncertain. Retry safely using the same request
                  key.
                </p>
                <button
                  disabled={busy}
                  onClick={() => submitCommand(null, null, pending)}
                >
                  Retry request
                </button>
              </>
            )}
          </div>
        )}
        <div className="eyebrow">
          {account?.name} / {state?.date || "Loading"}
        </div>
        <h1>{workspaces[view][1]}</h1>
        <p>Every holding follows the settled transaction ledger.</p>
        {!state ? (
          <section className="card">
            <p>Loading account…</p>
            <button onClick={() => load().catch((e) => setError(e.message))}>
              Reload
            </button>
          </section>
        ) : (
          <>
            <div className="stats">
              {[
                ["Portfolio value", money(p.value), "Settled valuation"],
                ["Available cash", money(p.cash), "USD cash ledger"],
                [
                  "Unrealized P&L",
                  money(p.unrealized),
                  "Market-price valuation",
                ],
                [
                  "Total return",
                  p.returnPct === null
                    ? "Unavailable"
                    : p.returnPct.toFixed(3) + "%",
                  "Since opening deposit",
                ],
              ].map(([label, value, sub]) => (
                <div className="card" key={label}>
                  <small>{label}</small>
                  <div className="metric">{value}</div>
                  <small>{sub}</small>
                </div>
              ))}
            </div>
            <section className="card market-health">
              <div className="row">
                <h2>Market & valuation</h2>
                <Status value={p.valuationStatus} />
              </div>
              <p className="muted">
                {state.priceSet?.provider === "mock"
                  ? "Deterministic simulation prices"
                  : "Alpha Vantage daily close prices"}{" "}
                · Business date {state.date}
                {state.dayClosed ? " · Closed valuation published" : ""}
              </p>
              {state.priceSet?.lastError && (
                <p className="notice">
                  Refresh failed: {state.priceSet.lastError}. Last available
                  prices are retained.
                </p>
              )}
              {p.valuationStatus !== "FRESH" && (
                <p>
                  Prices are missing or from an earlier trading date. Daily
                  reporting requires a complete current-date price set.
                </p>
              )}
            </section>
            <fieldset disabled={busy || !!pending} className="workspace">
              {view === "investment" && <Investment state={state} cmd={cmd} />}
              {view === "operations" && <Operations state={state} cmd={cmd} />}
              {view === "client" && (
                <Client state={state} exportReport={exportReport} />
              )}
            </fieldset>
          </>
        )}
      </main>
    </div>
  );
}
function Holdings({ positions }) {
  return (
    <section className="card">
      <h2>Settled holdings</h2>
      <Table
        headers={[
          "SECURITY",
          "SHARES",
          "AVG COST",
          "MARKET VALUE",
          "UNREALIZED",
        ]}
        empty={!positions.length}
      >
        {positions.map((p) => (
          <tr key={p.symbol}>
            <td>{p.symbol}</td>
            <td>{p.quantity}</td>
            <td>{money(p.averageCost)}</td>
            <td>{money(p.marketValue)}</td>
            <td>
              {money(p.marketValue === null ? null : p.marketValue - p.cost)}
            </td>
          </tr>
        ))}
      </Table>
    </section>
  );
}
function Investment({ state, cmd }) {
  const [type, setType] = useState("MARKET");
  function create(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    cmd("create", {
      symbol: f.get("symbol"),
      side: f.get("side"),
      quantity: Number(f.get("quantity")),
      orderType: type,
      ...(type === "LIMIT"
        ? { limitPrice: Math.round(Number(f.get("limit")) * 100) }
        : {}),
    });
  }
  return (
    <>
      <div className="grid">
        <div>
          <section className="card">
            <h2>
              Market watch <small>/ simulation quotes</small>
            </h2>
            <Table headers={["SECURITY", "COMPANY", "QUOTE", "AS OF"]}>
              {state.securities.map((s) => (
                <tr key={s.symbol}>
                  <td>{s.symbol}</td>
                  <td>{s.name}</td>
                  <td>{money(s.price)}</td>
                  <td>{s.asOf || "Missing"}</td>
                </tr>
              ))}
            </Table>
          </section>
          <Holdings positions={state.portfolio.positions} />
        </div>
        <section className="card">
          <h2>Create order</h2>
          <form onSubmit={create}>
            <fieldset disabled={state.dayClosed} className="workspace">
              <label>
                Security
                <select name="symbol">
                  {state.securities.map((s) => (
                    <option key={s.symbol}>{s.symbol}</option>
                  ))}
                </select>
              </label>
              <label>
                Side
                <select name="side">
                  <option>BUY</option>
                  <option>SELL</option>
                </select>
              </label>
              <label>
                Shares
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  defaultValue="100"
                  required
                />
              </label>
              <label>
                Order type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option>MARKET</option>
                  <option>LIMIT</option>
                </select>
              </label>
              {type === "LIMIT" && (
                <label>
                  Limit price (USD)
                  <input
                    name="limit"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                  />
                </label>
              )}
              <button className="primary">Create order →</button>
            </fieldset>
          </form>
          <p className="muted">
            Approval precedes execution. T+1 weekdays. $5 fee per fill.
          </p>
        </section>
      </div>
      <section className="card">
        <h2>Order book</h2>
        <Table
          headers={["SECURITY", "SIDE", "SHARES", "FILLED", "STATUS", "ACTION"]}
          empty={!state.orders.length}
        >
          {state.orders
            .slice()
            .reverse()
            .map((o) => (
              <tr key={o.id}>
                <td>{o.symbol}</td>
                <td>{o.side}</td>
                <td>{o.quantity}</td>
                <td>{o.filled}</td>
                <td>
                  <Status value={o.status} />
                </td>
                <td>
                  {o.status === "PENDING" ? (
                    <button
                      disabled={state.dayClosed}
                      onClick={() => cmd("approve", { id: o.id })}
                    >
                      Approve
                    </button>
                  ) : ["APPROVED", "PARTIALLY_FILLED", "SUBMITTED"].includes(
                      o.status
                    ) ? (
                    <form
                      className="inline-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        cmd("execute", {
                          id: o.id,
                          quantity: Number(
                            new FormData(e.currentTarget).get("quantity")
                          ),
                        });
                      }}
                    >
                      <input
                        key={o.filled}
                        name="quantity"
                        aria-label={`Fill quantity ${o.symbol}`}
                        type="number"
                        min="1"
                        max={o.quantity - o.filled}
                        step="1"
                        defaultValue={o.quantity - o.filled}
                        required
                      />
                      <button disabled={state.dayClosed}>Execute fill</button>
                    </form>
                  ) : (
                    "Complete"
                  )}
                </td>
              </tr>
            ))}
        </Table>
      </section>
    </>
  );
}
function Operations({ state, cmd }) {
  const [bookError, setBookError] = useState("");
  function submitBook(event) {
    event.preventDefault();
    setBookError("");
    const f = new FormData(event.currentTarget);
    try {
      const positions = JSON.parse(f.get("positions"));
      if (!Array.isArray(positions))
        throw Error("Positions must be a JSON array");
      cmd("reconcileBook", {
        asOf: state.date,
        broker: f.get("broker"),
        cash: Math.round(Number(f.get("cash")) * 100),
        positions,
      });
    } catch (e) {
      setBookError(e.message);
    }
  }
  const latestRun = state.reconciliationRuns?.at(-1);

  return (
    <>
      <section className="card">
        <div className="row">
          <div>
            <h2>Daily valuation control</h2>
            <p className="muted">
              Refresh prices → reconcile cash and positions → close and publish.
            </p>
          </div>
          <button onClick={() => cmd("refreshMarket")}>
            Refresh market data
          </button>
        </div>
        <p>
          Business date {state.date} · {state.dayClosed ? "CLOSED" : "OPEN"} ·
          Last full reconciliation:{" "}
          {latestRun
            ? latestRun.date + " / " + latestRun.broker
            : "Not submitted"}
        </p>
        {state.marketJobs?.slice(0, 1).map((job) => (
          <p key={job.id}>
            Market refresh: <Status value={job.status} />
            {job.error && " · " + job.error}
          </p>
        ))}
        <button
          className="primary"
          disabled={state.dayClosed}
          onClick={() => cmd("closeValuation")}
        >
          Close daily valuation & publish report
        </button>
        <p className="muted">
          Closing freezes the day’s prices, ledger version and reconciliation
          evidence. Advance the date before further trading or settlement.
        </p>
      </section>
      <section className="card">
        <div className="row">
          <h2>Settlement queue</h2>
          <button onClick={() => cmd("advance")}>
            Advance business date →
          </button>
        </div>
        <p className="muted">
          T+1 skips weekends. Exchange holidays are not modeled.
        </p>
        <Table
          headers={[
            "SECURITY",
            "SIDE / SHARES",
            "EXECUTION",
            "DUE",
            "STATUS",
            "ACTION",
          ]}
          empty={!state.trades.length}
        >
          {state.trades
            .slice()
            .reverse()
            .map((t) => (
              <tr key={t.id}>
                <td>{t.symbol}</td>
                <td>
                  {t.side} / {t.quantity}
                </td>
                <td>{money(t.price)}</td>
                <td>{t.due}</td>
                <td>
                  <Status value={t.status} />
                  {t.reason && <p>{t.reason}</p>}
                </td>
                <td>
                  {t.status !== "SETTLED" ? (
                    <button
                      disabled={state.dayClosed}
                      onClick={() => cmd("settle", { id: t.id })}
                    >
                      {t.status === "FAILED" ? "Retry settlement" : "Settle"}
                    </button>
                  ) : (
                    "Posted to ledger"
                  )}
                </td>
              </tr>
            ))}
        </Table>
      </section>
      <div className="grid">
        <section className="card">
          <h2>Cash & position reconciliation</h2>
          <form onSubmit={submitBook}>
            <fieldset className="workspace" disabled={state.dayClosed}>
              <label>
                Broker / statement source
                <input
                  name="broker"
                  defaultValue="Simulated broker"
                  maxLength="80"
                  required
                />
              </label>
              <label>
                Broker-reported settled cash (USD)
                <input
                  name="cash"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={(state.portfolio.cash / 100).toFixed(2)}
                  required
                />
              </label>
              <label>
                Broker-reported positions (JSON)
                <textarea
                  name="positions"
                  rows="4"
                  defaultValue='[{"symbol":"MSFT","quantity":98}]'
                  required
                />
              </label>
              <p className="muted">
                Omitted holdings are compared against zero shares. Statement
                date: {state.date}.
              </p>
              <button>Reconcile full statement</button>
              {bookError && <p role="alert">{bookError}</p>}
            </fieldset>
          </form>
          <details>
            <summary>
              Single-position investigation (does not certify the full book)
            </summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                cmd("reconcile", {
                  symbol: f.get("symbol"),
                  actual: Number(f.get("actual")),
                });
              }}
            >
              <label>
                Security
                <select name="symbol">
                  {state.securities.map((s) => (
                    <option key={s.symbol}>{s.symbol}</option>
                  ))}
                </select>
              </label>
              <label>
                Broker-reported settled shares
                <input
                  name="actual"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue="98"
                  required
                />
              </label>
              <button disabled={state.dayClosed}>Compare positions</button>
            </form>
          </details>
          <Table
            headers={["SECURITY", "INTERNAL", "BROKER", "STATUS", "RESOLUTION"]}
            empty={!state.exceptions.length}
          >
            {state.exceptions.map((e) => (
              <tr key={e.id}>
                <td>{e.symbol}</td>
                <td>{e.kind === "CASH" ? money(e.expected) : e.expected}</td>
                <td>{e.kind === "CASH" ? money(e.actual) : e.actual}</td>
                <td>
                  <Status value={e.status} />
                </td>
                <td>
                  {e.status === "OPEN" ? (
                    <form
                      onSubmit={(f) => {
                        f.preventDefault();
                        cmd("resolve", {
                          id: e.id,
                          note: new FormData(f.currentTarget).get("note"),
                        });
                      }}
                    >
                      <input
                        name="note"
                        aria-label="Resolution note"
                        minLength="5"
                        maxLength="1000"
                        placeholder="Investigation note"
                        required
                      />
                      <button>Resolve</button>
                    </form>
                  ) : (
                    e.note || "Matched"
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </section>
        <section className="card">
          <h2>Audit timeline</h2>
          {state.events
            .slice(-12)
            .reverse()
            .map((e) => (
              <div className="activity" key={e.id}>
                {e.type}
                <small>
                  {e.actor} · {new Date(e.at).toLocaleString()}
                  <br />
                  {e.entity}
                </small>
              </div>
            ))}
        </section>
      </div>
      <section className="card">
        <h2>Transaction ledger</h2>
        <Table
          headers={["TYPE", "SECURITY", "SHARES", "CASH MOVEMENT", "TRADE"]}
        >
          {state.ledger
            .slice()
            .reverse()
            .map((e) => (
              <tr key={e.id}>
                <td>{e.type}</td>
                <td>{e.symbol || "USD"}</td>
                <td>{e.quantity}</td>
                <td>{money(e.cash)}</td>
                <td>{e.tradeId?.slice(0, 8) || "Opening deposit"}</td>
              </tr>
            ))}
        </Table>
      </section>
    </>
  );
}
function Client({ state, exportReport }) {
  const p = state.portfolio,
    performance = state.performance,
    points = performance?.points || [];
  const latest = points.at(-1),
    series = points.length
      ? points
      : [{ date: state.date, cumulativeReturnPct: 0, benchmarkReturnPct: 0 }];
  const values = series.flatMap((x) => [
      x.cumulativeReturnPct,
      x.benchmarkReturnPct,
    ]),
    min = Math.min(0, ...values) - 0.1,
    max = Math.max(0, ...values) + 0.1;
  const line = (field) =>
    series
      .map(
        (point, i) =>
          `${30 + (i / Math.max(1, series.length - 1)) * 740},${
            150 - ((point[field] - min) / (max - min)) * 120
          }`
      )
      .join(" ");
  const pct = (value) =>
    value === null || value === undefined ? "—" : value.toFixed(3) + "%";
  return (
    <>
      <div className="stats">
        {[
          [
            "Last closed return",
            pct(latest?.cumulativeReturnPct),
            "Since inception",
          ],
          [
            "Daily return",
            pct(latest?.dailyReturnPct),
            "Only for consecutive business-day closes",
          ],
          [
            "VTI benchmark",
            pct(latest?.benchmarkReturnPct),
            "Price-only return",
          ],
          [
            "Excess return",
            latest ? latest.excessReturnPct.toFixed(3) + " pp" : "—",
            "Portfolio minus benchmark",
          ],
        ].map(([label, value, note]) => (
          <div className="card" key={label}>
            <small>{label}</small>
            <div className="metric">{value}</div>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="grid">
        <section className="card">
          <div className="row">
            <h2>Performance vs VTI</h2>
            <button
              disabled={
                !state.reportStatus?.latestDaily ||
                state.reportStatus?.dailyPending > 0
              }
              onClick={exportReport}
            >
              Export daily report ↓
            </button>
          </div>
          {state.reportStatus?.dailyPending > 0 && (
            <p className="muted">
              Daily report is being generated.
              {state.reportStatus.lastError && " Worker needs attention."}
            </p>
          )}
          {!points.length ? (
            <p>
              No certified daily valuation yet. Operations must reconcile and
              close the book.
            </p>
          ) : (
            <>
              <svg
                viewBox="0 0 800 180"
                role="img"
                aria-label="Cumulative portfolio and VTI price returns"
              >
                <path
                  d="M30 150H770 M30 90H770 M30 30H770"
                  stroke="#edf1ec"
                  fill="none"
                />
                <polyline
                  points={line("cumulativeReturnPct")}
                  fill="none"
                  stroke="#3c8055"
                  strokeWidth="3"
                />
                <polyline
                  points={line("benchmarkReturnPct")}
                  fill="none"
                  stroke="#b49648"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                />
              </svg>
              <div className="row muted">
                <span>Green: Portfolio · Gold: VTI</span>
                <span>Closed through {latest.date}</span>
              </div>
            </>
          )}
          <p className="muted">
            Reports freeze reconciled daily values and price provenance. Missing
            days have an interval return, not an invented daily return.
            Benchmark excludes dividends and corporate-action adjustments.
          </p>
          {state.daily?.at(-1)?.reconciliation && (
            <p>
              Latest certification:{" "}
              <Status value={state.daily.at(-1).reconciliation.status} />
              {state.daily.at(-1).reconciliation.status ===
                "RESOLVED_WITH_EXCEPTIONS" &&
                " Differences were acknowledged with investigation notes."}
            </p>
          )}
        </section>
        <section className="card">
          <h2>Current asset allocation</h2>
          {p.value === null ? (
            <p>
              Allocation unavailable until held-security prices are available.
            </p>
          ) : (
            [
              ["Cash", p.cash],
              ...p.positions.map((x) => [x.symbol, x.marketValue]),
            ].map(([name, value]) => (
              <div key={name}>
                <div className="row">
                  <span>{name}</span>
                  <span>
                    {p.value > 0
                      ? ((value / p.value) * 100).toFixed(1) + "%"
                      : "—"}
                  </span>
                </div>
                <div className="allocation">
                  <span
                    style={{
                      width: p.value > 0 ? (value / p.value) * 100 + "%" : "0%",
                    }}
                  />
                </div>
              </div>
            ))
          )}
          <p>
            Realized price P&amp;L: {money(p.realized)}
            <br />
            Execution fees: {money(p.fees)}
          </p>
          <p className="muted">
            Current valuation may differ from the last closed report.
          </p>
        </section>
      </div>
      <Holdings positions={p.positions} />
      <section className="card">
        <h2>Certified daily history</h2>
        <Table
          headers={[
            "DATE",
            "VALUE",
            "DAILY RETURN",
            "INTERVAL RETURN",
            "TOTAL RETURN",
            "VTI",
            "EXCESS",
          ]}
          empty={!points.length}
        >
          {points.map((point) => (
            <tr key={point.date}>
              <td>{point.date}</td>
              <td>{money(point.value)}</td>
              <td>{pct(point.dailyReturnPct)}</td>
              <td>{pct(point.periodReturnPct)}</td>
              <td>{pct(point.cumulativeReturnPct)}</td>
              <td>{pct(point.benchmarkReturnPct)}</td>
              <td>{point.excessReturnPct.toFixed(3)} pp</td>
            </tr>
          ))}
        </Table>
      </section>
      <section className="card">
        <h2>Transaction history</h2>
        <Table
          headers={[
            "DATE",
            "SECURITY",
            "SIDE",
            "SHARES",
            "EXECUTION",
            "STATUS",
          ]}
          empty={!state.trades.length}
        >
          {state.trades.map((t) => (
            <tr key={t.id}>
              <td>{t.tradeDate}</td>
              <td>{t.symbol}</td>
              <td>{t.side}</td>
              <td>{t.quantity}</td>
              <td>{money(t.price)}</td>
              <td>
                <Status value={t.status} />
              </td>
            </tr>
          ))}
        </Table>
      </section>
    </>
  );
}
