import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { loadAuth } from "./auth";
import { SessionProvider } from "./session";
import "./styles.css";

registerSW({ immediate: true });

const auth = await loadAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider auth={auth}>
      <App />
    </SessionProvider>
  </StrictMode>,
);
