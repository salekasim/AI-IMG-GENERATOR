import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import { LoadingBlock } from './components/ui';
import { AnalyticsPage } from './pages/AnalyticsPage';
import AuditPage from './pages/AuditPage';
import DashboardPage from './pages/DashboardPage';
import ExecutionsPage from './pages/ExecutionsPage';
import LoginPage from './pages/LoginPage';
import { ProjectsPage } from './pages/ProjectsPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import { WorkflowBuilderPage } from './pages/WorkflowBuilderPage';
import { WorkflowListPage } from './pages/WorkflowListPage';

function Protected() {
  const { user, ready } = useAuth();
  if (!ready) return <LoadingBlock label="Restoring session…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Protected />}>
          <Route index element={<DashboardPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="executions" element={<ExecutionsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="workflows" element={<WorkflowListPage />} />
          <Route path="workflows/:workflowId" element={<WorkflowBuilderPage />} />
          <Route path="projects" element={<ProjectsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
