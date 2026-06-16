import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Toaster } from "sonner"
import { LangProvider } from "./lib/lang"
import AdminLayout from "./layouts/AdminLayout"
import Dashboard from "./pages/Dashboard"
import AccountsPage from "./pages/AccountsPage"
import TestPage from "./pages/TestPage"
import TokensPage from "./pages/TokensPage"
import SettingsPage from "./pages/SettingsPage"
import GeneratorPage from "./pages/GeneratorPage"

function App() {
  return (
    <LangProvider>
      <Toaster position="top-center" richColors />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="generator" element={<GeneratorPage />} />
            <Route path="tokens" element={<TokensPage />} />
            <Route path="test" element={<TestPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LangProvider>
  )
}

export default App
