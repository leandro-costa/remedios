import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Layout, Notice, Spinner } from "./components/Layout";
import { ConflictsPage } from "./pages/ConflictsPage";
import { DosePage } from "./pages/DosePage";
import { FamilyPage } from "./pages/FamilyPage";
import { HealthPage } from "./pages/HealthPage";
import { MeasurementDetailPage, SymptomDetailPage } from "./pages/HealthDetailPages";
import { HistoryPage } from "./pages/HistoryPage";
import { MeasurementFormPage } from "./pages/MeasurementFormPage";
import { SymptomFormPage } from "./pages/SymptomFormPage";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { TodayPage } from "./pages/TodayPage";
import { TreatmentDetailPage } from "./pages/TreatmentDetailPage";
import { TreatmentFormPage } from "./pages/TreatmentFormPage";
import { TreatmentsPage } from "./pages/TreatmentsPage";
import { useSession } from "./session";

export function App() {
  const session = useSession();
  if (session.loading) return <Spinner />;
  if (!session.user) return <LoginPage />;
  if (session.error && !session.me) {
    return (
      <div className="page narrow">
        <Notice tone="error">{session.error}</Notice>
        <button className="btn" onClick={() => void session.refresh()}>Tentar de novo</button>
      </div>
    );
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/entrar-na-familia" element={<OnboardingPage />} />
        {session.family ? (
          <Route element={<Layout />}>
            <Route index element={<TodayPage />} />
            <Route path="doses/:id" element={<DosePage />} />
            <Route path="tratamentos" element={<TreatmentsPage />} />
            <Route path="tratamentos/novo" element={<TreatmentFormPage />} />
            <Route path="tratamentos/:id" element={<TreatmentDetailPage />} />
            <Route path="tratamentos/:id/editar" element={<TreatmentFormPage />} />
            <Route path="historico" element={<HistoryPage />} />
            <Route path="saude" element={<HealthPage />} />
            <Route path="saude/aferir" element={<MeasurementFormPage />} />
            <Route path="saude/sintoma" element={<SymptomFormPage />} />
            <Route path="saude/afericoes/:id" element={<MeasurementDetailPage />} />
            <Route path="saude/sintomas/:id" element={<SymptomDetailPage />} />
            <Route path="familia" element={<FamilyPage />} />
            <Route path="conflitos" element={<ConflictsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/entrar-na-familia" replace />} />
        )}
      </Routes>
    </BrowserRouter>
  );
}
