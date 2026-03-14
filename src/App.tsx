import { useState, useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { StatusStrip } from "./components/StatusStrip";
import { ToastProvider, useToast } from "./context/ToastContext";
import { Dashboard } from "./pages/Dashboard";
import { Projects } from "./pages/Projects";
import { Settings } from "./pages/Settings";
import { Onboarding } from "./pages/Onboarding";
import { Models } from "./pages/Models";
import { Analytics } from "./pages/Analytics";
import { Privacy } from "./pages/Privacy";
import { Memory } from "./pages/Memory";
import { Agents } from "./pages/Agents";
import "./App.css";

// Listens to Tauri service events and fires toasts
function ServiceEventListener() {
  const { addToast } = useToast();

  useEffect(() => {
    const unsub1 = listen<string>("service-offline", (e) => {
      addToast("error", `${e.payload} went offline`, 6000);
    });
    const unsub2 = listen<string>("service-restarted", (e) => {
      addToast("info", `${e.payload} was auto-restarted`);
    });
    return () => {
      unsub1.then((f) => f());
      unsub2.then((f) => f());
    };
  }, [addToast]);

  return null;
}

function AppShell() {
  return (
    <HashRouter>
      <div className="app-layout">
        <Sidebar />
        <div className="app-body">
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/models" element={<Models />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/memory" element={<Memory />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
          <StatusStrip />
        </div>
      </div>
      <Toasts />
      <ServiceEventListener />
    </HashRouter>
  );
}

export default function App() {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>("get_onboarding_done")
      .then(setOnboardingDone)
      .catch(() => setOnboardingDone(false));
  }, []);

  if (onboardingDone === null) return null;

  return (
    <ToastProvider>
      {!onboardingDone ? (
        <Onboarding onComplete={() => setOnboardingDone(true)} />
      ) : (
        <AppShell />
      )}
    </ToastProvider>
  );
}
