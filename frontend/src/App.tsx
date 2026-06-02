import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthGuard } from "@/components/AuthGuard";
import { MainLayout } from "@/components/MainLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Plans from "@/pages/Plans";
import Knowledge from "@/pages/Knowledge";
import Materials from "@/pages/Materials";
import LearningCenter from "@/pages/LearningCenter";
import Statistics from "@/pages/Statistics";
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
                  <Route path="/plans" element={<Plans />} />
                  <Route path="/knowledge" element={<Knowledge />} />
                  <Route path="/materials" element={<Materials />} />
                  <Route path="/learning" element={<LearningCenter />} />
                  <Route path="/statistics" element={<Statistics />} />
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
