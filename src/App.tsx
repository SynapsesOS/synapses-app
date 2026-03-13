import { useState, useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { Projects } from "./pages/Projects";
import { Settings } from "./pages/Settings";
import { Onboarding } from "./pages/Onboarding";
import { Models } from "./pages/Models";
import { Analytics } from "./pages/Analytics";
import { Scout } from "./pages/Scout";
import "./App.css";

export default function App() {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>("get_onboarding_done")
      .then(setOnboardingDone)
      .catch(() => setOnboardingDone(false));
  }, []);

  if (onboardingDone === null) return null; // loading

  if (!onboardingDone) {
    return <Onboarding onComplete={() => setOnboardingDone(true)} />;
  }

  return (
    <HashRouter>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/models" element={<Models />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/scout" element={<Scout />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
