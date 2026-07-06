import { HashRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StoreProvider } from './store/useStore';
import { ChatProvider } from './components/ChatContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { Dashboard } from './pages/Dashboard';
import { Apiaries, ApiaryDetail } from './pages/Apiaries';
import { Hives } from './pages/Hives';
import { HiveDetail } from './pages/HiveDetail';
import { InspectionList, InspectionFormPage } from './pages/InspectionList';
import { InspectionDetail } from './pages/InspectionDetail';
import { Sensors, SensorDetail } from './pages/Sensors';
import { Tasks } from './pages/Tasks';
import { Settings } from './pages/Settings';
import { VarroaCounter } from './pages/VarroaCounter';
import { SwarmRisk } from './pages/SwarmRisk';
import { FrameAnalysisPage } from './pages/FrameAnalysis';
import { SmartSchedule } from './pages/SmartSchedule';
import { QuickInspect } from './pages/QuickInspect';
import { HealthTrends } from './pages/HealthTrends';
import { Treatments } from './pages/Treatments';
import { ForageForecast } from './pages/ForageForecast';
import { AcousticAnalysis } from './pages/AcousticAnalysis';
import { QueenTracking } from './pages/QueenTracking';
import { OutlierDetection } from './pages/OutlierDetection';
import { ColonyMap } from './pages/ColonyMap';

export default function App() {
  return (
    <StoreProvider>
      <ThemeProvider>
        <ChatProvider>
          <HashRouter>
          <Layout>
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
          </Layout>
        </HashRouter>
        </ChatProvider>
      </ThemeProvider>
    </StoreProvider>
  );
}

// Wrapper components to extract :id param
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