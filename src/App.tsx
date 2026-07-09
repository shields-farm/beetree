import { HashRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { StoreProvider } from './store/useStore';
import { ChatProvider } from './components/ChatContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { Dashboard } from './pages/Dashboard';
import { SetupWizard } from './components/SetupWizard';
import { hasApiKey, API_BASE, getApiKey } from './lib/apiBase';

// Lazy-load all non-dashboard pages for code-splitting
const HivesHub = lazy(() => import('./pages/HivesHub').then(m => ({ default: m.HivesHub })));
const HiveDetail = lazy(() => import('./pages/HiveDetail').then(m => ({ default: m.HiveDetail })));
const InspectionsHub = lazy(() => import('./pages/InspectionsHub').then(m => ({ default: m.InspectionsHub })));
const InspectionFormPage = lazy(() => import('./pages/InspectionList').then(m => ({ default: m.InspectionFormPage })));
const InspectionDetail = lazy(() => import('./pages/InspectionDetail').then(m => ({ default: m.InspectionDetail })));
const SensorsHub = lazy(() => import('./pages/SensorsHub').then(m => ({ default: m.SensorsHub })));
const SensorDetail = lazy(() => import('./pages/Sensors').then(m => ({ default: m.SensorDetail })));
const Tasks = lazy(() => import('./pages/Tasks').then(m => ({ default: m.Tasks })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Pests = lazy(() => import('./pages/Pests').then(m => ({ default: m.Pests })));
const ForageForecast = lazy(() => import('./pages/ForageForecast').then(m => ({ default: m.ForageForecast })));
const Equipment = lazy(() => import('./pages/Equipment').then(m => ({ default: m.Equipment })));
const Hardware = lazy(() => import('./pages/Hardware').then(m => ({ default: m.Hardware })));

import { useParams } from 'react-router-dom';
function HiveDetailPage() {
  const { id } = useParams();
  return <HiveDetail id={id ?? ''} />;
}
function InspectionDetailPage() {
  const { id } = useParams();
  return <InspectionDetail id={id ?? ''} />;
}
function SensorDetailPage() {
  const { id } = useParams();
  return <SensorDetail id={id ?? ''} />;
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-16 text-stone-400 dark:text-stone-500">
      <div className="w-6 h-6 border-2 border-honey-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  const [showWizard, setShowWizard] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // No key in localStorage → show wizard
    if (!hasApiKey()) {
      setShowWizard(true);
      setChecking(false);
      return;
    }
    // Key exists — check if DB has data
    fetch(API_BASE + '/api/setup/status', {
      headers: { 'Authorization': 'Bearer ' + (getApiKey() || '') },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((status) => {
        if (status && !status.hasData) {
          setShowWizard(true);
        }
        setChecking(false);
      })
      .catch(() => {
        // Server not reachable — let the app try normally
        setChecking(false);
      });
  }, []);

  if (showWizard) {
    return (
      <ThemeProvider>
        <SetupWizard />
      </ThemeProvider>
    );
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-2 border-honey-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <StoreProvider>
      <ThemeProvider>
        <ChatProvider>
          <HashRouter>
          <Layout>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inspections" element={<InspectionsHub />} />
            <Route path="/inspections/new" element={<InspectionFormPage />} />
            <Route path="/inspections/:id" element={<InspectionDetailPage />} />
            <Route path="/hives" element={<HivesHub />} />
            <Route path="/hives/:id" element={<HiveDetailPage />} />
            <Route path="/sensors" element={<SensorsHub />} />
            <Route path="/sensors/:id" element={<SensorDetailPage />} />
            <Route path="/pests" element={<Pests />} />
            <Route path="/forage" element={<ForageForecast />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/equipment" element={<Equipment />} />
            <Route path="/hardware" element={<Hardware />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
          </Suspense>
          </Layout>
        </HashRouter>
        </ChatProvider>
      </ThemeProvider>
    </StoreProvider>
  );
}