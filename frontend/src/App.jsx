// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useAuthStore } from "./store/authStore";

import Layout     from "./components/ui/Layout";
import LoginPage  from "./pages/LoginPage";
import DashboardPage    from "./pages/DashboardPage";
import ExperimentPage   from "./pages/ExperimentPage";
import TrainingPage     from "./pages/TrainingPage";
import BacktestPage     from "./pages/BacktestPage";
import PredictionPage   from "./pages/PredictionPage";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function ProtectedRoute({ children }) {
  const token = useAuthStore(s => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={
            <ProtectedRoute><Layout /></ProtectedRoute>
          }>
            <Route index element={<DashboardPage />} />
            <Route path="experiment/new"     element={<ExperimentPage />} />
            <Route path="experiment/:id"     element={<ExperimentPage />} />
            <Route path="run/:id/status"     element={<TrainingPage />} />
            <Route path="run/:id/backtest"   element={<BacktestPage />} />
            <Route path="run/:id/prediction" element={<PredictionPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
