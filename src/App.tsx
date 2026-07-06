import { HashRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { StoreProvider } from './store/useStore';
import { ChatProvider } from './components/ChatContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { Dashboard } from './pages/Dashboard';

// Lazy-load all non-dashboard pages for code-splitting
const Apiaries = lazy(() => import('./pages/Apiaries').then(m => ({ default: m.Apiaries })));
const ApiaryDetail = lazy(() => import('./pages/Apiaries').then(m => ({ default: m.ApiaryDetail })));
const Hives = lazy(() => import('./pages/Hives').then(m => ({ default: m.Hives })));
const HiveDetail = lazy(() => import('./pages/HiveDetail').then(m => ({ default: m.HiveDetail })));
const InspectionList = lazy(() => import('./pages/InspectionList').then(m => ({ default: m.InspectionList })));
const InspectionFormPage = lazy(() => import('./pages/InspectionList').then(m => ({ default: m.InspectionFormPage })));
const InspectionDetail = lazy(() => import('./pages/InspectionDetail').then(m => ({ default: m.InspectionDetail })));
const Sensors = lazy(() => import('./pages/Sensors').then(m => ({ default: m.Sensors })));
const SensorDetail = lazy(() => import('./pages/Sensors').then(m => ({ default: m.SensorDetail })));
const Tasks = lazy(() => import('./pages/Tasks').then(m => ({ default: m.Tasks })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const VarroaCounter = lazy(() => import('./pages/VarroaCounter').then(m => ({ default: m.VarroaCounter })));
const SwarmRisk = lazy(() => import('./pages/SwarmRisk').then(m => ({ default: m.SwarmRisk })));
const FrameAnalysisPage = lazy(() => import('./pages/FrameAnalysis').then(m => ({ default: m.FrameAnalysisPage })));
const SmartSchedule = lazy(() => import('./pages/SmartSchedule').then(m => ({ default: m.SmartSchedule })));
const QuickInspect = lazy(() => import('./pages/QuickInspect').then(m => ({ default: m.QuickInspect })));
const HealthTrends = lazy(() => import('./pages/HealthTrends').then(m => ({ default: m.HealthTrends })));
const Treatments = lazy(() => import('./pages/Treatments').then(m => ({ default: m.Treatments })));
const ForageForecast = lazy(() => import('./pages/ForageForecast').then(m => ({ default: m.ForageForecast })));
const AcousticAnalysis = lazy(() => import('./pages/AcousticAnalysis').then(m => ({ default: m.AcousticAnalysis })));
const QueenTracking = lazy(() => import('./pages/QueenTracking').then(m => ({ default: m.QueenTracking })));
const OutlierDetection = lazy(() => import('./pages/OutlierDetection').then(m => ({ default: m.OutlierDetection })));
const ColonyMap = lazy(() => import('./pages/ColonyMap').then(m => ({ default: m.ColonyMap })));

import { useParams } from 'react-router-dom';
function ApiaryDetailPage() {
  const { id } = useParams();
  return <ApiaryDetail id={id ?? ''} />;
}
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
  return (
    <StoreProvider>
      <ThemeProvider>
        <ChatProvider>
          <HashRouter>
          <Layout>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/apiaries" element={<Apiaries />} />
            <Route path="/apiaries/:id" element={<ApiaryDetailPage />} />
            <Route path="/hives" element={<Hives />} />
            <Route path="/hives/:id" element={<HiveDetailPage />} />
            <Route path="/inspections" element={<InspectionList />} />
            <Route path="/inspections/new" element={<InspectionFormPage />} />
            <Route path="/inspections/:id" element={<InspectionDetailPage />} />
            <Route path="/sensors" element={<Sensors />} />
            <Route path="/sensors/:id" element={<SensorDetailPage />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/frame-analysis" element={<FrameAnalysisPage />} />
            <Route path="/varroa" element={<VarroaCounter />} />
            <Route path="/swarm" element={<SwarmRisk />} />
            <Route path="/schedule" element={<SmartSchedule />} />
            <Route path="/quick-inspect" element={<QuickInspect />} />
            <Route path="/trends" element={<HealthTrends />} />
            <Route path="/treatments" element={<Treatments />} />
            <Route path="/forage" element={<ForageForecast />} />
            <Route path="/acoustics" element={<AcousticAnalysis />} />
            <Route path="/queen" element={<QueenTracking />} />
            <Route path="/outliers" element={<OutlierDetection />} />
            <Route path="/colony-map" element={<ColonyMap />} />
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