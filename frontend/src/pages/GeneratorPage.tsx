import { useState, useRef, useEffect } from "react"
import { Button } from "../components/ui/button"
import { Wand2, StopCircle, Trash2, Download, RefreshCw, Play, Square, Plus } from "lucide-react"
import { toast } from "sonner"
import { getAuthHeader } from "../lib/auth"
import { API_BASE } from "../lib/api"
import { useLang } from "../lib/lang"

type GeneratedAccount = {
  email: string
  password: string
  jwtToken?: string
  timestamp: number
  status: "success" | "failed"
  error?: string
}

type LogLine = {
  ts: number
  text: string
  level: "info" | "error" | "success"
}

type DaemonAccount = {
  email: string
  in_daemon: boolean
  sessions: number
}

type DaemonRam = {
  daemon_mb: number
  chromium_total_mb: number
  chromium_avg_mb: number
  chromium_procs: number
  system_used_pct: number
  system_used_mb: number
  system_total_mb: number
  estimated_mb_per_session: number
}

type DaemonStatus = {
  running: boolean
  pid: number | null
  pool: { valid: number; total: number }
  accounts: DaemonAccount[]
  ram?: DaemonRam
}

export default function GeneratorPage() {
  const { tr } = useLang()
  const g = tr.generator
  // Generator state
  const [genRunning, setGenRunning] = useState(false)
  const [count, setCount] = useState(1)
  const [parallel, setParallel] = useState(0) // 0 = sequential, >0 = parallel count
  const [accounts, setAccounts] = useState<GeneratedAccount[]>([])
  const [logs, setLogs] = useState<LogLine[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const logEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Daemon state
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null)
  const [daemonLogs, setDaemonLogs] = useState<string[]>([])
  const [poolSize, setPoolSize] = useState(5)
  const [maxAccounts, setMaxAccounts] = useState(0)
  const [browserCount, setBrowserCount] = useState(0)
  const [tabsPerBrowser, setTabsPerBrowser] = useState(5)
  const [daemonLoading, setDaemonLoading] = useState(false)
  const [lazyMode, setLazyMode] = useState(false)
  const daemonLogEndRef = useRef<HTMLDivElement>(null)
  const daemonPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [logs])
  useEffect(() => { daemonLogEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [daemonLogs])
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (daemonPollRef.current) clearInterval(daemonPollRef.current)
  }, [])

  // Poll daemon status
  useEffect(() => {
    const fetchDaemon = async () => {
      try {
        const [statusRes, logsRes, cfgRes] = await Promise.all([
          fetch(`${API_BASE}/api/daemon/status`, { headers: getAuthHeader() }),
          fetch(`${API_BASE}/api/daemon/logs?lines=80`, { headers: getAuthHeader() }),
          fetch(`${API_BASE}/api/config`, { headers: getAuthHeader() }),
        ])
        if (statusRes.ok) setDaemon(await statusRes.json())
        if (logsRes.ok) {
          const d = await logsRes.json()
          setDaemonLogs(d.lines || [])
        }
        if (cfgRes.ok) {
          const cfg = await cfgRes.json()
          setLazyMode(cfg.lazy_session || false)
        }
      } catch {}
    }
    fetchDaemon()
    daemonPollRef.current = setInterval(fetchDaemon, 3000)
    return () => { if (daemonPollRef.current) clearInterval(daemonPollRef.current) }
  }, [])

  const addLog = (text: string, level: LogLine["level"] = "info") => {
    setLogs(prev => [...prev, { ts: Date.now(), text, level }])
  }

  const startGeneration = async () => {
    setGenRunning(true)
    setLogs([])
    setAccounts([])
    setSelected(new Set())
    addLog(`${count} hesap üretiliyor...`, "info")
    try {
      const res = await fetch(`${API_BASE}/api/accounts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ count, parallel: parallel > 0, parallel_count: parallel }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        addLog(`Hata: ${err.detail || `HTTP ${res.status}`}`, "error")
        setGenRunning(false)
        return
      }
      const data = await res.json()
      setJobId(data.job_id)

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE}/api/accounts/generate/${data.job_id}`, { headers: getAuthHeader() })
          if (!statusRes.ok) return
          const status = await statusRes.json()
          if (status.logs?.length) {
            setLogs(prev => {
              const existing = new Set(prev.map((l: LogLine) => l.text + l.ts))
              const newLines: LogLine[] = status.logs
                .filter((l: any) => !existing.has(l.text + l.ts))
                .map((l: any) => ({ ...l, level: l.level || "info" }))
              return [...prev, ...newLines]
            })
          }
          if (status.accounts?.length) setAccounts(status.accounts)
          if (status.done) {
            clearInterval(pollRef.current!)
            setGenRunning(false)
            setJobId(null)
            const ok = status.accounts?.filter((a: GeneratedAccount) => a.status === "success").length || 0
            addLog(`Tamamlandı! ${ok}/${count} g.success.`, ok > 0 ? "success" : "error")
            if (ok > 0) toast.success(`${ok} hesap oluşturuldu`)
            else toast.error("g.failed")
          }
        } catch {}
      }, 2000)
    } catch (e: any) {
      addLog(`İstek hatası: ${e.message}`, "error")
      setGenRunning(false)
    }
  }

  const stopGeneration = async () => {
    if (!jobId) return
    try {
      await fetch(`${API_BASE}/api/accounts/generate/${jobId}/cancel`, { method: "POST", headers: getAuthHeader() })
    } catch {}
    if (pollRef.current) clearInterval(pollRef.current)
    setGenRunning(false)
    setJobId(null)
    addLog("Durduruldu.", "error")
  }

  const toggleSelect = (email: string) => {
    setSelected(prev => {
      const s = new Set(prev)
      if (s.has(email)) s.delete(email)
      else s.add(email)
      return s
    })
  }

  const selectAllSuccess = () => {
    const emails = accounts.filter(a => a.status === "success").map(a => a.email)
    setSelected(new Set(emails))
  }

  const addToDaemon = async () => {
    if (!selected.size) { toast.error(g.selectAll); return }
    try {
      const res = await fetch(`${API_BASE}/api/accounts/add-to-daemon`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ emails: [...selected] }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`${data.added?.length || 0} g.addToDaemon`)
        setSelected(new Set())
      } else {
        toast.error(data.detail || "Hata")
      }
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const startDaemon = async () => {
    setDaemonLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/daemon/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ pool_size: poolSize, max_accounts: maxAccounts, browser_count: browserCount, tabs_per_browser: tabsPerBrowser }),
      })
      const data = await res.json()
      if (res.ok) toast.success(`${g.start2} (PID: ${data.pid})`)
      else toast.error(data.detail || "Başlatılamadı")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDaemonLoading(false)
    }
  }

  const stopDaemon = async () => {
    setDaemonLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/daemon/stop`, { method: "POST", headers: getAuthHeader() })
      const data = await res.json()
      if (res.ok) toast.success(g.stop2)
      else toast.error(data.detail || "Durdurulamadı")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDaemonLoading(false)
    }
  }

  const handleExport = () => {
    const ok = accounts.filter(a => a.status === "success")
    if (!ok.length) { toast.error("g.noAccounts"); return }
    const blob = new Blob([JSON.stringify(ok, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const el = document.createElement("a"); el.href = url; el.download = "accounts.json"; el.click()
    URL.revokeObjectURL(url)
    toast.success(`${ok.length} g.export`)
  }

  const logColor = (level: LogLine["level"]) => {
    if (level === "error") return "text-red-400"
    if (level === "success") return "text-emerald-400"
    return "text-slate-300"
  }

  const succeeded = accounts.filter(a => a.status === "success").length
  const failed = accounts.filter(a => a.status === "failed").length

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">{g.title}</h2>
        <p className="text-muted-foreground mt-1">{g.subtitle}</p>
      </div>

      {/* Generator */}
      <div className="rounded-2xl border bg-card/40 p-5 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{g.settings}</h3>
        <div className="flex flex-wrap gap-4 items-end">
          <div className="w-36">
            <label className="text-xs font-semibold mb-1.5 block">{g.numAccounts}</label>
            <input type="number" min={1} max={50} value={count}
              onChange={e => setCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
              disabled={genRunning}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
          </div>
          <div className="w-36">
            <label className="text-xs font-semibold mb-1.5 block">{g.parallel} <span className="text-muted-foreground font-normal">(0 = sequential)</span></label>
            <input type="number" min={0} max={20} value={parallel}
              onChange={e => setParallel(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
              disabled={genRunning}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
          </div>
          <div className="flex gap-2 items-center">
            {!genRunning ? (
              <Button onClick={startGeneration} className="h-9">
                <Wand2 className="mr-1.5 h-4 w-4" /> {g.start}
              </Button>
            ) : (
              <Button onClick={stopGeneration} variant="destructive" className="h-9">
                <StopCircle className="mr-1.5 h-4 w-4" /> {g.stop}
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-9" onClick={() => { setLogs([]); setAccounts([]); setSelected(new Set()) }} disabled={genRunning}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {g.clear}
            </Button>
            {accounts.length > 0 && (
              <Button variant="outline" size="sm" className="h-9" onClick={handleExport} disabled={!succeeded}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> {g.export}
              </Button>
            )}
          </div>
          {(genRunning || accounts.length > 0) && (
            <div className="flex gap-4 items-center ml-auto">
              <span className="text-xs text-muted-foreground">{g.progress} <b>{accounts.length}/{count}</b></span>
              <span className="text-xs text-emerald-500">✓ {succeeded}</span>
              <span className="text-xs text-red-500">✗ {failed}</span>
              {genRunning && <RefreshCw className="h-3.5 w-3.5 text-muted-foreground animate-spin" />}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Log */}
          <div className="rounded-xl border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/10">
              <span className="text-xs font-bold">Log</span>
              {genRunning && <RefreshCw className="h-3 w-3 text-primary animate-spin" />}
            </div>
            <div className="bg-slate-950 h-56 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
              {logs.length === 0 && <span className="text-slate-500">{g.waiting}</span>}
              {logs.map((l, i) => (
                <div key={i} className={logColor(l.level)}>
                  <span className="text-slate-600 mr-2">{new Date(l.ts).toLocaleTimeString()}</span>
                  {l.text}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* Accounts table */}
          <div className="rounded-xl border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/10">
              <span className="text-xs font-bold">{g.generatedAccounts}</span>
              <div className="flex gap-2">
                {succeeded > 0 && (
                  <button onClick={selectAllSuccess} className="text-xs text-primary hover:underline">{g.selectAll}</button>
                )}
                {selected.size > 0 && (
                  <Button size="sm" className="h-6 text-xs px-2" onClick={addToDaemon}>
                    <Plus className="mr-1 h-3 w-3" /> {g.addToDaemon} ({selected.size})
                  </Button>
                )}
              </div>
            </div>
            <div className="h-56 overflow-y-auto">
              {accounts.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">{g.noAccounts}</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/20 text-muted-foreground uppercase sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left w-8"></th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">{g.status}</th>
                      <th className="px-3 py-2 text-left">Token</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {accounts.map((acc, i) => (
                      <tr key={i} className={`hover:bg-muted/10 cursor-pointer ${selected.has(acc.email) ? "bg-primary/5" : ""}`}
                        onClick={() => acc.status === "success" && toggleSelect(acc.email)}>
                        <td className="px-3 py-2">
                          {acc.status === "success" && (
                            <input type="checkbox" checked={selected.has(acc.email)} onChange={() => toggleSelect(acc.email)}
                              className="rounded" onClick={e => e.stopPropagation()} />
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono">{acc.email}</td>
                        <td className="px-3 py-2">
                          {acc.status === "success"
                            ? <span className="text-emerald-500 font-semibold">✓ OK</span>
                            : <span className="text-red-500 font-semibold" title={acc.error}>✗ Hata</span>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {acc.jwtToken ? <span className="text-emerald-500">✓</span> : <span className="text-red-400">✗</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Daemon */}
      <div className="rounded-2xl border bg-card/40 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{g.daemonTitle}</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`h-2 w-2 rounded-full ${daemon?.running ? "bg-emerald-500" : "bg-slate-500"}`} />
            <span className="text-xs text-muted-foreground">
              {daemon?.running ? `${g.running} (PID: ${daemon.pid})` : g.stopped}
            </span>
            {daemon?.running && (
              <span className="text-xs font-semibold text-emerald-500">${g.pool}: ${daemon.pool.valid} sessions</span>
            )}
            {daemon?.ram && (
              <>
                <span className="text-xs text-muted-foreground border-l pl-3">
                  Chromium: <b className="text-foreground">{daemon.ram.chromium_total_mb} MB</b> ({daemon.ram.chromium_procs} procs, ~{daemon.ram.chromium_avg_mb} MB avg)
                </span>
                <span className="text-xs text-muted-foreground">
                  System: <b className={`${daemon.ram.system_used_pct > 80 ? "text-red-400" : daemon.ram.system_used_pct > 60 ? "text-yellow-400" : "text-foreground"}`}>{daemon.ram.system_used_pct}%</b> ({daemon.ram.system_used_mb} / {daemon.ram.system_total_mb} MB)
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-end">
          {lazyMode ? (
            <>
              <div className="w-44">
                <label className="text-xs font-semibold mb-1.5 block">Browser count <span className="text-muted-foreground font-normal">(0 = all)</span></label>
                <input type="number" min={0} max={50} value={browserCount}
                  onChange={e => setBrowserCount(Math.max(0, Math.min(50, parseInt(e.target.value) || 0)))}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
              </div>
              <div className="w-44">
                <label className="text-xs font-semibold mb-1.5 block">Tabs/browser</label>
                <input type="number" min={1} max={20} value={tabsPerBrowser}
                  onChange={e => setTabsPerBrowser(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
              </div>
            </>
          ) : (
            <>
              <div className="w-36">
                <label className="text-xs font-semibold mb-1.5 block">{g.targetSessions}</label>
                <input type="number" min={1} max={200} value={poolSize}
                  onChange={e => setPoolSize(Math.max(1, Math.min(200, parseInt(e.target.value) || 15)))}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
              </div>
              <div className="w-40">
                <label className="text-xs font-semibold mb-1.5 block">{g.pool} <span className="text-muted-foreground font-normal">(0 = all)</span></label>
                <input type="number" min={0} max={100} value={maxAccounts}
                  onChange={e => setMaxAccounts(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
              </div>
              {daemon?.accounts?.length ? (
                <div className="text-xs text-muted-foreground">
                  ~<b className="text-foreground">{Math.ceil(poolSize / daemon.accounts.length)}</b> {g.sessionsPerAccount}
                  {daemon?.ram && (
                    <span className="ml-2 text-yellow-400">≈ {Math.round(poolSize * (daemon.ram.estimated_mb_per_session || 150))} {g.estimatedRam}</span>
                  )}
                </div>
              ) : null}
            </>
          )}
          <div className="flex gap-2">
            <Button onClick={startDaemon} disabled={daemonLoading || daemon?.running} className="h-9">
              <Play className="mr-1.5 h-4 w-4" /> Start
            </Button>
            <Button onClick={stopDaemon} variant="destructive" disabled={daemonLoading || !daemon?.running} className="h-9">
              <Square className="mr-1.5 h-4 w-4" /> Stop
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Account list */}
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2 border-b bg-muted/10">
              <span className="text-xs font-bold">{g.daemonAccounts}</span>
            </div>
            <div className="divide-y divide-border/40">
              {!daemon?.accounts?.length ? (
                <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">{g.emptyAccounts}</div>
              ) : (
                [...(daemon.accounts)].sort((a, b) => (b.in_daemon ? 1 : 0) - (a.in_daemon ? 1 : 0)).map((acc, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${acc.sessions > 0 ? "bg-emerald-500" : "bg-slate-400"}`} />
                      <span className="font-mono text-muted-foreground">{acc.email}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-semibold ${acc.in_daemon ? "text-emerald-500" : "text-slate-400"}`}>
                        {acc.in_daemon ? g.inDaemon : g.inactive}
                      </span>
                      <span className="text-muted-foreground">{acc.sessions} {g.sessions}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Daemon log */}
          <div className="rounded-xl border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/10">
              <span className="text-xs font-bold">{g.daemonLog}</span>
              {daemon?.running && <RefreshCw className="h-3 w-3 text-primary animate-spin" />}
            </div>
            <div className="bg-slate-950 h-48 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
              {daemonLogs.length === 0 && <span className="text-slate-500">{g.noLog}</span>}
              {daemonLogs.map((line, i) => (
                <div key={i} className={
                  line.includes("✓") ? "text-emerald-400" :
                  line.includes("✗") || line.includes("Error") || line.includes("Fatal") ? "text-red-400" :
                  "text-slate-300"
                }>{line}</div>
              ))}
              <div ref={daemonLogEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
