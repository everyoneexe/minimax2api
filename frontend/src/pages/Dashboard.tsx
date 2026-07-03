import { useEffect, useState, useRef } from "react"
import { Server, Activity, Zap, Layers, Key, TrendingUp, RefreshCw, Clock } from "lucide-react"
import { getAuthHeader } from "../lib/auth"
import { API_BASE } from "../lib/api"
import { useLang } from "../lib/lang"

type AccountStatus = {
  name: string
  email: string
  is_active: boolean
  depleted?: boolean
  temporarily_no_credits?: boolean
  request_count: number
  last_used: number
  auth_mode: string
  max_concurrent?: number
  current_concurrent?: number
  token_status?: "valid" | "expiring" | "expired" | "none"
  token_expires?: number
  token_expires_in?: number
  agent_id?: string
}

export default function Dashboard() {
  const { tr } = useLang()
  const d = tr.dashboard

  const [accStatus, setAccStatus] = useState<AccountStatus[]>([])
  const [models, setModels] = useState<string[]>([])
  const [usage, setUsage] = useState({ total_requests: 0, total_tokens: 0 })
  const [isTokenMode, setIsTokenMode] = useState(true)
  const [reqHistory, setReqHistory] = useState<number[]>(Array(24).fill(0))
  const prevReqRef = useRef<number | null>(null)

  const fetchData = async () => {
    try {
      const [statusRes, usageRes, modelsRes, cfgRes] = await Promise.all([
        fetch(`${API_BASE}/api/accounts/status`, { headers: getAuthHeader() }),
        fetch(`${API_BASE}/api/usage`, { headers: getAuthHeader() }),
        fetch(`${API_BASE}/api/models`, { headers: getAuthHeader() }),
        fetch(`${API_BASE}/api/config`, { headers: getAuthHeader() }),
      ])
      if (statusRes.ok) setAccStatus(await statusRes.json())
      if (usageRes.ok) {
        const u = await usageRes.json()
        const total = u.total_requests || 0
        setReqHistory(prev => {
          if (prevReqRef.current === null) { prevReqRef.current = total; return prev }
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
      if (cfgRes.ok) {
        const cfg = await cfgRes.json()
        setIsTokenMode(!cfg.lazy_session)
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err)
    }
  }

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, 5000)
    return () => clearInterval(t)
  }, [])

  const active = accStatus.filter(a => a.is_active && !a.depleted).length
  const depleted = accStatus.filter(a => a.depleted).length
  const total = accStatus.length
  const tokenValid = accStatus.filter(a => a.token_status === "valid").length
  const tokenNone = accStatus.filter(a => a.token_status === "none" || a.token_status === "expired").length

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">{d.title}</h2>
          <p className="text-muted-foreground mt-1">{d.subtitle}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${isTokenMode ? "bg-cyan-500/15 text-cyan-400" : "bg-orange-500/15 text-orange-400"}`}>
          {isTokenMode ? "Token Mode" : "Lazy Mode"}
        </span>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Server className="h-4 w-4" />} color="emerald"
          title={d.availableAccounts} value={String(active)}
          sub={`${depleted} depleted · ${total} total`} />
        <StatCard icon={<Key className="h-4 w-4" />} color="cyan"
          title="JWT Tokens" value={String(tokenValid)}
          sub={`${tokenNone} need refresh · ${total} total`} />
        <StatCard icon={<Activity className="h-4 w-4" />} color="violet"
          title={d.totalRequests} value={String(usage.total_requests)}
          sub={d.cumulative} />
        <StatCard icon={<Layers className="h-4 w-4" />} color="orange"
          title={d.availableModels} value={String(models.length)}
          sub={models.slice(0, 2).join(", ")} />
      </div>

      {/* Account table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
                  {isTokenMode && <th className="px-3 py-2 text-left">JWT</th>}
                  <th className="px-3 py-2 text-right">Load</th>
                  <th className="px-3 py-2 text-right">{d.requests}</th>
                  <th className="px-3 py-2 text-right">{d.lastUsed}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {[...accStatus].sort((a, b) => {
                  const score = (x: AccountStatus) => x.is_active && !x.depleted ? 2 : 0
                  return score(b) - score(a)
                }).map((a, i) => (
                  <tr key={i} className="hover:bg-muted/10">
                    <td className="px-4 py-2 font-mono">{a.name}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                        a.temporarily_no_credits ? "bg-purple-500/15 text-purple-400" :
                        a.depleted ? "bg-red-500/15 text-red-400" :
                        a.is_active ? "bg-emerald-500/15 text-emerald-400" :
                        "bg-slate-500/15 text-slate-400"}`}>
                        {a.temporarily_no_credits ? "No Credits" : a.depleted ? "Depleted" : a.is_active ? d.normal : d.disabled}
                      </span>
                    </td>
                    {isTokenMode && (
                      <td className="px-3 py-2">
                        <TokenBadge status={a.token_status} expiresIn={a.token_expires_in} />
                      </td>
                    )}
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

        {/* Right column */}
        <div className="space-y-4">
          {/* Token mode info */}
          {isTokenMode ? (
            <div className="rounded-xl border bg-card/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">Token Mode</span>
                <span className="h-2 w-2 rounded-full bg-cyan-500" />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-muted/20 rounded-lg p-2">
                  <div className="text-muted-foreground mb-1">Valid JWT</div>
                  <div className="font-bold text-lg text-cyan-400">{tokenValid}</div>
                  <div className="text-muted-foreground">cached tokens</div>
                </div>
                <div className="bg-muted/20 rounded-lg p-2">
                  <div className="text-muted-foreground mb-1">Need Refresh</div>
                  <div className={`font-bold text-lg ${tokenNone > 0 ? "text-yellow-400" : "text-emerald-400"}`}>{tokenNone}</div>
                  <div className="text-muted-foreground">on next use</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground border-t pt-2">
                Puppeteer only runs when a token needs refresh. Normal requests are pure HTTP.
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-card/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">{d.sessionDaemon}</span>
                <span className="h-2 w-2 rounded-full bg-orange-500" />
              </div>
              <div className="text-xs text-muted-foreground">
                Legacy lazy mode active. Switch to token mode in Settings for lower RAM usage.
              </div>
            </div>
          )}

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
              { path: "GET /v1/models", tag: "Models", color: "slate" },
              { path: "GET /health", tag: d.healthCheck, color: "slate" },
              { path: "GET /admin/", tag: "WebUI", color: "cyan" },
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

function TokenBadge({ status, expiresIn }: { status?: string; expiresIn?: number }) {
  if (status === "valid") {
    const days = Math.floor((expiresIn || 0) / 86400)
    return (
      <span className="flex items-center gap-1 text-emerald-400 font-semibold">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {days}d
      </span>
    )
  }
  if (status === "expiring") {
    const hours = Math.floor((expiresIn || 0) / 3600)
    return (
      <span className="flex items-center gap-1 text-yellow-400 font-semibold">
        <Clock className="h-3 w-3" />
        {hours}h
      </span>
    )
  }
  if (status === "expired") {
    return <span className="text-red-400 font-semibold">expired</span>
  }
  return <span className="text-muted-foreground">—</span>
}

function StatCard({ icon, color, title, value, sub }: {
  icon: React.ReactNode; color: string; title: string; value: string; sub?: string
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    blue: "text-blue-400 bg-blue-500/10",
    violet: "text-violet-400 bg-violet-500/10",
    orange: "text-orange-400 bg-orange-500/10",
    cyan: "text-cyan-400 bg-cyan-500/10",
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
