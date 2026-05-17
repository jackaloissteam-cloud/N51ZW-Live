import { useEffect } from "react";
import "@/App.css";
import "leaflet/dist/leaflet.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Tracker from "@/pages/Tracker";

function App() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      // Best-effort early permission request
      try {
        Notification.requestPermission().catch(() => {});
      } catch (_) {}
    }
  }, []);

  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Tracker />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#141414",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.1)",
            fontFamily: "'IBM Plex Sans', sans-serif",
          },
        }}
      />
    </div>
  );
}

export default App;
