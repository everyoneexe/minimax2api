import { useEffect, useState, useRef } from "react"
import { Server, Activity, Zap, Layers, Database, Cpu, TrendingUp, AlertCircle } from "lucide-react"
import { getAuthHeader } from "../lib/auth"
import { API_BASE } from "../lib/api"
import { useLang } from "../lib/lang"

type AccountStatus = {
  name: string
  is_active: boolean
  request_count: number
  last_used: number
  auth_mode: string
  max_concurrent?: number
  current_concurrent?: number
}

type DaemonStatus = {
  running: boolean
  pid: number | null
  pool: { valid: number; total: number }
  accounts: { email: string; in_daemon: boolean; sessions: number }[]
  ram?: {
    daemon_mb: number
    chromium_total_mb: number
    chromium_procs: number
    system_used_pct: number
    system_used_mb: number
    system_total_mb: number
    estimated_mb_per_session: number
  }
}

export default function Dashboard() {
  const { tr } = useLang()
  const d = tr.dashboard

  const [accStatus, setAccStatus] = useState<AccountStatus[]>([])
  const [models, setModels] = useState<string[]>([])
  const [usage, setUsage] = useState({ total_requests: 0, total_tokens: 0 })
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null)
  const [reqHistory, setReqHistory] = useState<number[]>(Array(24).fill(0))
  const [errRate, setErrRate] = useState(0)
  const prevReqRef = useRef<number | null>(null)

  const fetchData = async () => {
    try {
      const [statusRes, usageRes, modelsRes, daemonRes] = await Promise.all([
        fetch(`${API_BASE}/api/accounts/status`, { headers: getAuthHeader() }),
        fetch(`${API_BASE}/api/usage`, { headers: getAuthHeader() }),
        fetch(`${API_BASE}/api/models`, { headers: getAuthHeader() }),
        fetch(`${API_BASE}/api/daemon/status`, { headers: getAuthHeader() }),
      ])
      if (statusRes.ok) setAccStatus(await statusRes.json())
      if (usageRes.ok) {
        const u = await usageRes.json()
        const total = u.total_requests || 0
        // Track request delta for mini chart — skip first poll to avoid spike
        setReqHistory(prev => {
          if (prevReqRef.current === null) {
            prevReqRef.current = total
            return prev
          }
          const delta = total - prevReqRef.current
          prevReqRef.current = total
          if (delta > 0) return [...prev.slice(1), delta]
          return prev
        })
        setUsage({ total_requests: total, total_tokens: u.total_tokens || 0 })
      }
      if (modelsRes.ok) {
        const data = await modelsRes.json()
        setModels(data.data?.map((m: any) => m.id) || data || [])
      }
      if (daemonRes.ok) setDaemon(await daemonRes.json())
    } catch (err) {
      console.error("Dashboard fetch error:", err)
    }
  }

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, 5000)
    return () => clearInterval(t)
  }, [])

  const active = accStatus.filter(a => a.is_active && !(a as any).depleted).length
  const depleted = accStatus.filter(a => (a as any).depleted).length
  const disabled = accStatus.filter(a => !a.is_active && !(a as any).depleted).length + depleted
  const total = accStatus.length
  const poolValid = daemon?.pool.valid ?? 0
  const poolTotal = daemon?.pool.total ?? 0

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">{d.title}</h2>
        <p className="text-muted-foreground mt-1">{d.subtitle}</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Server className="h-4 w-4" />} color="emerald"
          title={d.availableAccounts} value={String(active)}
          sub={`${disabled} disabled · ${total} total`} />
        <StatCard icon={<Database className="h-4 w-4" />} color="blue"
          title={d.pool} value={String(poolValid)}
          sub={`target ${poolTotal} · ${daemon?.running ? "running" : "stopped"}`} />
        <StatCard icon={<Activity className="h-4 w-4" />} color="violet"
          title={d.totalRequests} value={String(usage.total_requests)}
          sub={d.cumulative} />
        <StatCard icon={<Layers className="h-4 w-4" />} color="orange"
          title={d.availableModels} value={String(models.length)}
          sub={models.slice(0, 2).join(", ")} />
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Account status */}
        <div className="lg:col-span-2 rounded-xl border bg-card/30 overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/10 flex items-center justify-between">
            <span className="text-sm font-bold">{d.accountDetails}</span>
            <span className="text-xs text-muted-foreground">{total} {d.total}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/20 text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">{d.name}</th>
                  <th className="px-3 py-2 text-left">{d.status}</th>
                  <th className="px-3 py-2 text-right">Load</th>
                  <th className="px-3 py-2 text-right">{d.requests}</th>
                  <th className="px-3 py-2 text-right">{d.lastUsed}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {[...accStatus].sort((a,b) => {
                  const score = (x: AccountStatus) => x.is_active && !(x as any).depleted ? 2 : 0
                  return score(b) - score(a)
                }).map((a, i) => (
                  <tr key={i} className="hover:bg-muted/10">
                    <td className="px-4 py-2 font-mono">{a.name}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                        (a as any).depleted ? "bg-purple-500/15 text-purple-400" :
                        a.is_active ? "bg-emerald-500/15 text-emerald-400" :
                        "bg-red-500/15 text-red-400"}`}>
                        {(a as any).depleted ? "Depleted" : a.is_active ? d.normal : d.disabled}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`font-mono text-xs font-semibold ${
                          (a.current_concurrent || 0) >= (a.max_concurrent || 5) ? "text-red-400" :
                          (a.current_concurrent || 0) > 0 ? "text-yellow-400" : "text-muted-foreground"
                        }`}>
                          {a.current_concurrent || 0}/{a.max_concurrent || 5}
                        </span>
                        <div className="w-12 bg-muted/30 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full transition-all ${
                            (a.current_concurrent || 0) >= (a.max_concurrent || 5) ? "bg-red-500" :
                            (a.current_concurrent || 0) > 0 ? "bg-yellow-500" : "bg-emerald-500/30"
                          }`} style={{ width: `${Math.min(100, ((a.current_concurrent || 0) / (a.max_concurrent || 5)) * 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{a.request_count}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {a.last_used ? new Date(a.last_used * 1000).toLocaleTimeString() : d.never}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Daemon + RAM */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{d.sessionDaemon}</span>
              <span className={`h-2 w-2 rounded-full ${daemon?.running ? "bg-emerald-500" : "bg-slate-500"}`} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/20 rounded-lg p-2">
                <div className="text-muted-foreground mb-1">{d.pool}</div>
                <div className="font-bold text-lg">{poolValid}</div>
                <div className="text-muted-foreground">{d.sessionsReady}</div>
              </div>
              <div className="bg-muted/20 rounded-lg p-2">
                <div className="text-muted-foreground mb-1">{d.active}</div>
                <div className="font-bold text-lg">{daemon?.accounts.filter(a => a.in_daemon).length ?? 0}</div>
                <div className="text-muted-foreground">{d.browsersOpen}</div>
              </div>
            </div>
            {daemon?.ram && (
              <div className="text-xs space-y-1.5 pt-1 border-t">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{d.chromiumRam}</span>
                  <span className="font-mono">{daemon.ram.chromium_total_mb} MB ({daemon.ram.chromium_procs} procs)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{d.system}</span>
                  <span className={`font-mono ${daemon.ram.system_used_pct > 80 ? "text-red-400" : daemon.ram.system_used_pct > 60 ? "text-yellow-400" : ""}`}>
                    {daemon.ram.system_used_pct}% ({daemon.ram.system_used_mb} / {daemon.ram.system_total_mb} MB)
                  </span>
                </div>
                <div className="w-full bg-muted/30 rounded-full h-1.5 mt-1">
                  <div className={`h-1.5 rounded-full transition-all ${daemon.ram.system_used_pct > 80 ? "bg-red-500" : daemon.ram.system_used_pct > 60 ? "bg-yellow-500" : "bg-emerald-500"}`}
                    style={{ width: `${daemon.ram.system_used_pct}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Request mini chart */}
          <div className="rounded-xl border bg-card/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold">{d.requestActivity}</span>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex items-end gap-0.5 h-12">
              {reqHistory.map((v, i) => {
                const max = Math.max(...reqHistory, 1)
                const h = Math.max(2, (v / max) * 100)
                return <div key={i} className="flex-1 bg-primary/40 rounded-sm transition-all" style={{ height: `${h}%` }} />
              })}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{d.lastPolls}</div>
          </div>
        </div>
      </div>

      {/* Models + Endpoints */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card/30 p-4">
          <div className="text-sm font-bold mb-3">{d.availableModelsTitle}</div>
          <div className="space-y-1.5">
            {models.map(m => (
              <div key={m} className="flex items-center justify-between px-3 py-2 bg-muted/20 rounded-lg text-xs">
                <span className="font-mono font-semibold">{m}</span>
                <span className="text-emerald-500 text-xs">● {d.active}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card/30 p-4">
          <div className="text-sm font-bold mb-3">{d.apiEndpoints}</div>
          <div className="space-y-1.5 text-xs">
            {[
              { path: "POST /v1/chat/completions", tag: "Chat", color: "emerald" },
              { path: "POST /v1/messages", tag: "Anthropic", color: "violet" },
              { path: "POST /v1/images/generations", tag: "Image", color: "blue" },
              { path: "GET /v1/models", tag: "Models", color: "slate" },
              { path: "GET /health", tag: d.healthCheck, color: "slate" },
            ].map(e => (
              <div key={e.path} className="flex items-center justify-between px-3 py-2 bg-muted/20 rounded-lg">
                <span className="font-mono">{e.path}</span>
                <span className={`px-1.5 py-0.5 rounded text-xs font-semibold bg-${e.color}-500/15 text-${e.color}-400`}>{e.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, color, title, value, sub }: {
  icon: React.ReactNode; color: string; title: string; value: string; sub?: string
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    blue: "text-blue-400 bg-blue-500/10",
    violet: "text-violet-400 bg-violet-500/10",
    orange: "text-orange-400 bg-orange-500/10",
  }
  return (
    <div className="rounded-xl border bg-card/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</span>
        <div className={`p-1.5 rounded-lg ${colors[color]}`}>{icon}</div>
      </div>
      <div className="text-3xl font-black">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  )
}
