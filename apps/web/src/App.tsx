import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AuditPage } from "./pages/AuditPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { ClientsPage } from "./pages/copilot/ClientsPage";
import { ReviewQueuePage } from "./pages/copilot/ReviewQueuePage";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="audits" element={<HistoryPage />} />
        <Route path="audits/:id" element={<AuditPage />} />
        <Route path="copilot/clients" element={<ClientsPage />} />
        <Route path="copilot/reviews" element={<ReviewQueuePage />} />
        <Route path="*" element={<p className="text-sm text-slate-600">Seite nicht gefunden.</p>} />
      </Route>
    </Routes>
  );
}
