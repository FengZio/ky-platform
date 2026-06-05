import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthGuard } from "@/components/AuthGuard";
import { MainLayout } from "@/components/MainLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Plans from "@/pages/Plans";
import LearningCenter from "@/pages/LearningCenter";
import Resources from "@/pages/Resources";
import Settings from "@/pages/Settings";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <AuthGuard>
              <MainLayout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/resources" element={<Resources />} />
                  <Route path="/knowledge" element={<Navigate to="/resources?tab=knowledge" replace />} />
                  <Route path="/materials" element={<Navigate to="/resources?tab=materials" replace />} />
                  <Route path="/questions" element={<Navigate to="/resources?tab=questions" replace />} />
                  <Route path="/queue" element={<Navigate to="/resources?tab=tasks" replace />} />
                  <Route path="/statistics" element={<Navigate to="/" replace />} />
                  <Route path="/plans" element={<Plans />} />
                  <Route path="/learning" element={<LearningCenter />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </MainLayout>
            </AuthGuard>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
