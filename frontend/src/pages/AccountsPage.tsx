import { useEffect, useMemo, useState } from "react"
import { Button } from "../components/ui/button"
import { Trash2, Plus, RefreshCw, ShieldCheck, Upload, Download, Wand2, Zap } from "lucide-react"
import { toast } from "sonner"
import { getAuthHeader } from "../lib/auth"
import { API_BASE } from "../lib/api"
import { Link } from "react-router-dom"
import { useLang } from "../lib/lang"

type AccountItem = {
  api_key: string
  name: string
  base_url: string
  auth_mode: string
  auth_token: string
  cookie: string
  is_active: boolean
  request_count: number
  max_concurrent?: number
}

type AccountStatus = {
  name: string
  is_active: boolean
  request_count: number
  last_used: number
  auth_mode: string
  api_key_preview: string
  max_concurrent?: number
  current_concurrent?: number
}

type FilterState = "all" | "active" | "disabled"

function statusBadge(s: { is_active: boolean; depleted?: boolean; temporarily_no_credits?: boolean }, c: { statusNormal: string; statusDisabled: string }) {
  if ((s as any).temporarily_no_credits)
    return { cls: "bg-purple-100 text-purple-700 ring-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:ring-purple-500/30", label: "No Credits (24h)" }
  if ((s as any).depleted)
    return { cls: "bg-red-100 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30", label: "Depleted" }
  if (s.is_active)
    return { cls: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30", label: c.statusNormal }
  return { cls: "bg-gray-100 text-gray-700 ring-gray-200 dark:bg-gray-500/15 dark:text-gray-300 dark:ring-gray-500/30", label: c.statusDisabled }
}

export default function AccountsPage() {
  const { tr } = useLang()
  const a = tr.accounts
  const c = tr.common

  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [statuses, setStatuses] = useState<AccountStatus[]>([])
  const [filter, setFilter] = useState<FilterState>("all")
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("https://agent.minimaxi.com")
  const [authMode, setAuthMode] = useState<"api_key" | "token">("token")
  const [authToken, setAuthToken] = useState("")
  const [cookie, setCookie] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [globalMaxConcurrent, setGlobalMaxConcurrent] = useState(25)

  const fetchData = () => {
    Promise.all([
      fetch(`${API_BASE}/api/config`, { headers: getAuthHeader() }).then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch(`${API_BASE}/api/accounts/status`, { headers: getAuthHeader() }).then(r => r.ok ? r.json() : []),
    ]).then(([cfg, status]) => {
      setAccounts(cfg.accounts || [])
      setStatuses(status)
      setGlobalMaxConcurrent(cfg.max_concurrent_requests || 25)
    }).catch((err) => toast.error(`Failed to refresh accounts (${err})`))
  }

  useEffect(() => { fetchData() }, [])

  const stats = useMemo(() => {
    let active = 0, disabled = 0, tempNoCredits = 0
    for (const s of statuses) {
      if ((s as any).temporarily_no_credits) tempNoCredits++
      else if ((s as any).depleted) disabled++
      else if (s.is_active) active++
      else disabled++
    }
    return { active, disabled, tempNoCredits, total: statuses.length, credits: active * 1000 }
  }, [statuses])

  const filtered = useMemo(() => {
    return accounts.filter((_, i) => {
      const s = statuses[i] || { is_active: accounts[i]?.is_active ?? true }
      if (filter === "active") return s.is_active && !(s as any).depleted && !(s as any).temporarily_no_credits
      if (filter === "disabled") return !s.is_active || (s as any).depleted || (s as any).temporarily_no_credits
      return true
    })
  }, [accounts, statuses, filter])

  const handleAdd = () => {
    if (!apiKey.trim() && !authToken.trim()) { toast.error("Please enter an API Key or Token"); return }
    const newAccounts = [...accounts, {
      api_key: apiKey.trim(),
      name: name.trim() || (apiKey.trim() || authToken.trim()).slice(0, 8),
      base_url: baseUrl.trim() || "https://api.minimax.io/v1",
      auth_mode: authMode,
      auth_token: authToken.trim(),
      cookie: cookie.trim(),
      is_active: true,
      request_count: 0,
    }]
    saveAccounts(newAccounts, () => { toast.success("Account added"); setApiKey(""); setName(""); setAuthToken(""); setCookie(""); setShowAdd(false) })
  }

  const handleDelete = (idx: number) => {
    const realIdx = accounts.indexOf(filtered[idx])
    saveAccounts(accounts.filter((_, i) => i !== realIdx), () => toast.success("Account deleted"))
  }

  const handleTest = (idx: number) => {
    const realIdx = accounts.indexOf(filtered[idx])
    const id = toast.loading(`Testing account ${realIdx + 1}...`)
    fetch(`${API_BASE}/api/test-account/${realIdx}`, { method: "POST", headers: getAuthHeader() })
      .then(r => r.json())
      .then(data => {
        if (data.success) toast.success(`Test passed: ${data.model}`, { id })
        else toast.error(`Test failed: ${data.error || "Unknown error"}`, { id, duration: 8000 })
        fetchData()
      })
      .catch(() => toast.error("Test request failed", { id }))
  }

  const handleToggle = (idx: number) => {
    const realIdx = accounts.indexOf(filtered[idx])
    const updated = accounts.map((acc, i) => i === realIdx ? { ...acc, is_active: !acc.is_active } : acc)
    saveAccounts(updated, () => toast.success("Status updated"))
  }

  const saveAccounts = (newAccounts: AccountItem[], onSuccess?: () => void) => {
    fetch(`${API_BASE}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify({ accounts: newAccounts }),
    }).then(r => { if (r.ok) { fetchData(); onSuccess?.() } else toast.error("Save failed") })
      .catch(() => toast.error("Request failed"))
  }

  const handleAutoDistribute = () => {
    if (accounts.length === 0) {
      toast.error("No accounts to distribute")
      return
    }
    const perAccount = Math.max(1, Math.floor(globalMaxConcurrent / accounts.length))
    const updated = accounts.map(acc => ({ ...acc, max_concurrent: perAccount }))
    saveAccounts(updated, () =>
      toast.success(`Auto-distributed: ${perAccount} concurrent per account (${globalMaxConcurrent} ÷ ${accounts.length})`)
    )
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(accounts, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const el = document.createElement("a"); el.href = url; el.download = "minimax_accounts.json"; el.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${accounts.length} accounts`)
  }

  const handleImport = () => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json"
    input.onchange = (e: any) => {
      const file = e.target.files?.[0]; if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string)
          const imported: AccountItem[] = Array.isArray(data) ? data : data.accounts || []
          if (!imported.length) { toast.error("No accounts found in file"); return }
          const merged = [...accounts]; let added = 0
          for (const acc of imported) {
            if (!merged.some(x => x.api_key === acc.api_key && x.auth_token === acc.auth_token)) { merged.push(acc); added++ }
          }
          saveAccounts(merged, () => toast.success(`Imported ${added} accounts`))
        } catch { toast.error("Invalid JSON file") }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const statCards = [
    { label: a.total, value: stats.total, color: "text-foreground", bg: "bg-card", sub: "" },
    { label: a.active, value: stats.active, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10", sub: `~${(stats.active * 1000).toLocaleString()} credits` },
    { label: "No Credits (24h)", value: stats.tempNoCredits, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-500/10", sub: "" },
    { label: a.disabled, value: stats.disabled, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-500/10", sub: "" },
  ]

  const filterLabels: Record<FilterState, string> = {
    all: `${a.all} (${stats.total})`,
    active: `${a.active} (${stats.active})`,
    disabled: `${a.disabled} (${stats.disabled})`,
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">{a.title}</h2>
          <p className="text-muted-foreground mt-1">{a.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { fetchData(); toast.success("Refreshed") }}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {a.refresh}
          </Button>
          <Button variant="outline" size="sm" onClick={handleAutoDistribute} disabled={!accounts.length}>
            <Zap className="mr-1.5 h-3.5 w-3.5" /> Auto-Distribute Concurrency
          </Button>
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> {a.import}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!accounts.length}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> {a.export}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/generator"><Wand2 className="mr-1.5 h-3.5 w-3.5" /> {a.autoGenerate}</Link>
          </Button>
          <Button size="sm" onClick={() => setShowAdd(v => !v)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> {a.addAccount}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map(card => (
          <div key={card.label} className={`rounded-xl border p-4 ${card.bg}`}>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{card.label}</div>
            <div className={`text-3xl font-black ${card.color}`}>{card.value}</div>
            {(card as any).sub && <div className="text-xs text-muted-foreground mt-1">{(card as any).sub}</div>}
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="rounded-2xl border bg-card/40 p-5 space-y-4">
          <h3 className="text-sm font-bold">{a.addManually}</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs font-semibold mb-1 block">{a.nameOptional}</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" placeholder={a.accountName} />
            </div>
            <div className="w-36">
              <label className="text-xs font-semibold mb-1 block">{a.authMode}</label>
              <select value={authMode} onChange={e => setAuthMode(e.target.value as "api_key" | "token")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="api_key">{a.apiKeyMode}</option>
                <option value="token">{a.tokenMode}</option>
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs font-semibold mb-1 block">{authMode === "token" ? a.token : a.apiKey}</label>
              <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono"
                placeholder={authMode === "token" ? a.bearerToken : "sk-..."} />
            </div>
            {authMode === "token" && (
              <div className="flex-1 min-w-[160px]">
                <label className="text-xs font-semibold mb-1 block">{a.authToken}</label>
                <input type="text" value={authToken} onChange={e => setAuthToken(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono" placeholder={a.sameAsAbove} />
              </div>
            )}
            {authMode === "token" && (
              <div className="w-full">
                <label className="text-xs font-semibold mb-1 block">Browser Cookie (ak_bmsc)</label>
                <textarea value={cookie} onChange={e => setCookie(e.target.value)}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-none" rows={2}
                  placeholder="Paste full Cookie header from browser DevTools Network tab" />
              </div>
            )}
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-semibold mb-1 block">{a.baseUrl}</label>
              <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
            </div>
            <Button onClick={handleAdd} size="sm" className="h-9">{a.add}</Button>
            <Button onClick={() => setShowAdd(false)} variant="ghost" size="sm" className="h-9">{a.cancel}</Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground">{a.filter}</span>
        {(["all", "active", "disabled"] as FilterState[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${filter === f ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {filterLabels[f]}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border bg-card/30 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/10">
          <h3 className="font-bold">{a.accountList}</h3>
          <span className="text-xs font-semibold bg-primary/10 text-primary rounded-full px-2.5 py-1">{filtered.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left font-semibold">{a.num}</th>
                <th className="px-4 py-3 text-left font-semibold">{a.name}</th>
                <th className="px-4 py-3 text-left font-semibold">{a.status}</th>
                <th className="px-4 py-3 text-left font-semibold">{a.auth}</th>
                <th className="px-4 py-3 text-right font-semibold">Load</th>
                <th className="px-4 py-3 text-right font-semibold">{a.requests || "Requests"}</th>
                <th className="px-4 py-3 text-right font-semibold">{a.lastUsed}</th>
                <th className="px-4 py-3 text-right font-semibold">{a.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                    {a.noAccounts}{" "}
                    <button onClick={() => setShowAdd(true)} className="text-primary underline-offset-2 hover:underline">{a.addOne}</button>
                    {" "}{a.orAutoGenerate && <Link to="/generator" className="text-primary underline-offset-2 hover:underline">{a.orAutoGenerate}</Link>}.
                  </td>
                </tr>
              )}
              {filtered.map((acc, i) => {
                const realIdx = accounts.indexOf(acc)
                const s = statuses[realIdx] || { is_active: acc.is_active }
                const badge = statusBadge(s, c)
                const isSelected = selectedIdx === realIdx
                return (
                  <>
                  <tr key={i} className={`hover:bg-muted/10 transition-colors cursor-pointer ${isSelected ? "bg-muted/20" : ""}`}
                    onClick={() => setSelectedIdx(isSelected ? null : realIdx)}>
                    <td className="px-6 py-3 text-muted-foreground text-xs">{realIdx + 1}</td>
                    <td className="px-4 py-3 font-medium font-mono text-xs">{acc.name || `Account ${realIdx + 1}`}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ring-1 ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">{acc.auth_mode === "token" ? c.tokenAuth : c.apiKeyAuth}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`font-mono text-xs font-semibold ${
                          (s.current_concurrent || 0) >= (s.max_concurrent || 5) ? "text-red-400" :
                          (s.current_concurrent || 0) > 0 ? "text-yellow-400" : "text-muted-foreground"
                        }`}>
                          {s.current_concurrent || 0}/{s.max_concurrent || 5}
                        </span>
                        <div className="w-10 bg-muted/30 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full transition-all ${
                            (s.current_concurrent || 0) >= (s.max_concurrent || 5) ? "bg-red-500" :
                            (s.current_concurrent || 0) > 0 ? "bg-yellow-500" : "bg-emerald-500/30"
                          }`} style={{ width: `${Math.min(100, ((s.current_concurrent || 0) / (s.max_concurrent || 5)) * 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{acc.request_count || 0}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground font-mono">
                      {statuses[realIdx]?.last_used ? new Date(statuses[realIdx].last_used * 1000).toLocaleString() : a.never}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={e => { e.stopPropagation(); handleTest(i) }}>
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" /> {a.test}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={e => { e.stopPropagation(); handleToggle(i) }}>
                          {s.is_active ? a.disable : a.enable}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={e => { e.stopPropagation(); handleDelete(i) }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {isSelected && (
                    <tr key={`detail-${i}`} className="bg-muted/10">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div>
                            <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Name</div>
                            <div className="font-mono">{acc.name || "-"}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Email</div>
                            <div className="font-mono">{(acc as any).email || "-"}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Auth Mode</div>
                            <div className="font-mono">{acc.auth_mode}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Status</div>
                            <div className={`font-semibold ${s.is_active ? "text-emerald-500" : "text-red-500"}`}>
                              {s.is_active ? "Active" : "Disabled"}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Requests</div>
                            <div className="font-mono">{acc.request_count || 0}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Last Used</div>
                            <div className="font-mono">{statuses[realIdx]?.last_used ? new Date(statuses[realIdx].last_used * 1000).toLocaleString() : "Never"}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Base URL</div>
                            <div className="font-mono text-muted-foreground">{acc.base_url || "-"}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Max Concurrent</div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={1}
                                max={50}
                                value={(acc as any).max_concurrent || 5}
                                onChange={e => {
                                  const newVal = Math.max(1, Math.min(50, parseInt(e.target.value) || 5))
                                  const updated = accounts.map((a, idx) =>
                                    idx === realIdx ? { ...a, max_concurrent: newVal } : a
                                  )
                                  saveAccounts(updated, () => toast.success("Concurrency updated"))
                                }}
                                onClick={e => e.stopPropagation()}
                                className="w-16 h-7 rounded border border-input bg-background px-2 text-xs font-mono"
                              />
                              <span className="text-xs text-muted-foreground">req/s</span>
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Current Load</div>
                            <div className={`font-mono font-semibold ${
                              (s.current_concurrent || 0) >= (s.max_concurrent || 5) ? "text-red-500" :
                              (s.current_concurrent || 0) > 0 ? "text-yellow-500" : "text-emerald-500"
                            }`}>
                              {s.current_concurrent || 0} / {s.max_concurrent || 5}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
