import { useState, useEffect } from "react"
import { Settings2, RefreshCw, KeyRound, ServerCrash, Code } from "lucide-react"
import { Button } from "../components/ui/button"
import { toast } from "sonner"
import { getAuthHeader } from "../lib/auth"
import { API_BASE } from "../lib/api"
import { useLang } from "../lib/lang"

export default function SettingsPage() {
  const { tr } = useLang()
  const t = tr.settings

  const [sessionKey, setSessionKey] = useState("")
  const [config, setConfig] = useState<any>(null)
  const [defaultModel, setDefaultModel] = useState("MiniMax-M2.7")
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelAliases, setModelAliases] = useState("")
  const [registerProxy, setRegisterProxy] = useState("")
  const [lazySession, setLazySession] = useState(false)
  const [poolTarget, setPoolTarget] = useState(0)
  const [maxConcurrent, setMaxConcurrent] = useState(25)

  const loadSessionKey = () => setSessionKey(localStorage.getItem('minimax2api_proxy_key') || "sk-minimax")

  const fetchConfig = () => {
    fetch(`${API_BASE}/api/config`, { headers: getAuthHeader() })
      .then(res => { if (!res.ok) throw new Error("Unauthorized"); return res.json() })
      .then(data => {
        setConfig(data)
        setDefaultModel(data.default_model || "MiniMax-M2.7")
        setAvailableModels(data.available_models || [])
        setModelAliases(JSON.stringify(data.model_aliases || {}, null, 2))
        setRegisterProxy(data.register_proxy || "")
        setLazySession(data.lazy_session || false)
        setPoolTarget(data.account_pool_target || 0)
        setMaxConcurrent(data.max_concurrent_requests || 25)
      })
      .catch(() => toast.error("Config fetch failed"))
  }

  useEffect(() => { loadSessionKey(); fetchConfig() }, [])

  const handleSaveSessionKey = () => {
    if (!sessionKey.trim()) { toast.error("Please enter a key"); return }
    localStorage.setItem('minimax2api_proxy_key', sessionKey.trim())
    toast.success("Key saved locally")
  }

  const handleClearSessionKey = () => {
    localStorage.removeItem('minimax2api_proxy_key')
    setSessionKey("")
    toast.success("Key cleared")
  }

  const handleSaveConfig = () => {
    const data: any = {
      default_model: defaultModel,
      register_proxy: registerProxy,
      lazy_session: lazySession,
      account_pool_target: poolTarget,
      max_concurrent_requests: maxConcurrent
    }
    if (config?.accounts) data.accounts = config.accounts
    if (config?.proxy_api_keys) data.proxy_api_keys = config.proxy_api_keys
    fetch(`${API_BASE}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeader() },
      body: JSON.stringify(data),
    }).then(r => { if (r.ok) { toast.success("Saved"); fetchConfig() } else toast.error("Save failed") })
      .catch(() => toast.error("Save failed"))
  }

  const handleSaveAliases = () => {
    try {
      const parsed = JSON.parse(modelAliases)
      fetch(`${API_BASE}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ ...config, model_aliases: parsed }),
      }).then(r => { if (r.ok) { toast.success("Aliases updated"); fetchConfig() } else toast.error("Save failed") })
    } catch { toast.error("Invalid JSON") }
  }

  const baseUrl = window.location.origin

  const curlExample = `# Streaming chat
curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'

# Non-streaming
curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'

# List models
curl ${baseUrl}/v1/models \\
  -H "Authorization: Bearer YOUR_API_KEY"`

  return (
    <div className="w-full max-w-5xl mx-auto min-w-0 overflow-x-hidden space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div className="min-w-0">
          <h2 className="text-3xl font-extrabold tracking-tight">{t.title}</h2>
          <p className="text-muted-foreground mt-1">{t.subtitle}</p>
        </div>
        <Button variant="outline" onClick={() => { fetchConfig(); toast.success("Refreshed") }}>
          <RefreshCw className="mr-2 h-4 w-4" /> {t.refreshConfig}
        </Button>
      </div>

      <div className="grid gap-6 min-w-0">
        {/* Session Key */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm min-w-0">
          <div className="flex flex-col space-y-1.5 p-6 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <h3 className="font-semibold leading-none tracking-tight">{t.sessionKey}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{t.sessionKeyDesc}</p>
          </div>
          <div className="p-6">
            <div className="flex gap-2 items-center flex-wrap">
              <input type="password" value={sessionKey} onChange={e => setSessionKey(e.target.value)}
                placeholder={t.sessionKeyPlaceholder}
                className="flex h-10 flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <Button onClick={handleSaveSessionKey}>{t.save}</Button>
              <Button variant="ghost" onClick={handleClearSessionKey}>{t.clear}</Button>
            </div>
          </div>
        </div>

        {/* Connection Info */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm min-w-0">
          <div className="flex flex-col space-y-1.5 p-6 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <ServerCrash className="h-5 w-5 text-primary" />
              <h3 className="font-semibold leading-none tracking-tight">{t.connectionInfo}</h3>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-1 min-w-0">
              <label className="text-sm font-medium">{t.apiBaseUrl}</label>
              <input type="text" readOnly value={baseUrl}
                className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm font-mono text-muted-foreground" />
            </div>
          </div>
        </div>

        {/* MiniMax Config */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm min-w-0">
          <div className="flex flex-col space-y-1.5 p-6 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              <h3 className="font-semibold leading-none tracking-tight">{t.minimaxConfig}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{t.minimaxConfigDesc}</p>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex justify-between items-center py-2 border-b flex-wrap gap-2">
              <span className="text-sm font-medium">{t.version}</span>
              <span className="font-mono text-sm">{config?.version || "1.1.0"}</span>
            </div>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t.defaultModel}</label>
                <select value={defaultModel} onChange={e => setDefaultModel(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {availableModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  {!availableModels.includes(defaultModel) && (
                    <option value={defaultModel}>{defaultModel}</option>
                  )}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Registration Proxy</label>
                <input type="text" value={registerProxy} onChange={e => setRegisterProxy(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  placeholder="http://user:pass@host:port" />
                <p className="text-xs text-muted-foreground">Optional HTTP proxy for account registration</p>
              </div>
              <div className="flex items-center justify-between py-2 border rounded-lg px-3">
                <div>
                  <div className="text-sm font-medium">Lazy Session Mode</div>
                  <div className="text-xs text-muted-foreground">Create session on-demand instead of using pool. Slower but no Puppeteer needed.</div>
                </div>
                <input type="checkbox" checked={lazySession} onChange={e => setLazySession(e.target.checked)}
                  className="h-4 w-4 rounded" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Account Pool Target <span className="text-muted-foreground font-normal text-xs">(0 = disabled)</span></label>
                <input type="number" min={0} max={1000} value={poolTarget}
                  onChange={e => setPoolTarget(Math.max(0, parseInt(e.target.value) || 0))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                <p className="text-xs text-muted-foreground">Auto-register new accounts when active pool drops below this number (sliding window)</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Max Concurrent Requests <span className="text-muted-foreground font-normal text-xs">(global limit)</span></label>
                <input type="number" min={1} max={500} value={maxConcurrent}
                  onChange={e => setMaxConcurrent(Math.max(1, parseInt(e.target.value) || 25))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                <p className="text-xs text-muted-foreground">
                  Total concurrent requests across all accounts. System auto-distributes load by each account's max_concurrent setting.
                  {config?.accounts?.length > 0 && (
                    <span className="block mt-1 text-primary font-semibold">
                      💡 Suggestion: With {config.accounts.length} account{config.accounts.length !== 1 ? 's' : ''},
                      set each account's max_concurrent to ~{Math.ceil(maxConcurrent / config.accounts.length)}
                      (= {maxConcurrent} ÷ {config.accounts.length})
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={handleSaveConfig}>{t.saveConfig}</Button>
            </div>
          </div>
        </div>

        {/* Model Aliases */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm min-w-0">
          <div className="flex flex-col space-y-1.5 p-6 border-b bg-muted/30">
            <h3 className="font-semibold leading-none tracking-tight">{t.modelAliases}</h3>
            <p className="text-sm text-muted-foreground">{t.modelAliasesDesc}</p>
          </div>
          <div className="p-6">
            <textarea rows={8} value={modelAliases} onChange={e => setModelAliases(e.target.value)}
              className="flex min-h-[160px] w-full rounded-md border border-input bg-slate-950 text-slate-300 px-3 py-2 text-sm font-mono"
              style={{ whiteSpace: "pre", overflowX: "auto" }} />
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSaveAliases}>{t.saveAliases}</Button>
            </div>
          </div>
        </div>

        {/* Usage Example */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm min-w-0">
          <div className="flex flex-col space-y-1.5 p-6 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <Code className="h-5 w-5 text-primary" />
              <h3 className="font-semibold leading-none tracking-tight">{t.usageExample}</h3>
            </div>
          </div>
          <div className="p-6 min-w-0">
            <pre className="bg-slate-950 rounded-lg p-4 text-xs font-mono text-slate-300 whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto overflow-x-hidden">
              {curlExample}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
