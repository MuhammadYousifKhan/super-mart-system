import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installGlobalErrorHandlers, logger } from "@/lib/logger";

installGlobalErrorHandlers();
logger.info("app", "Renderer started", { online: navigator.onLine });

createRoot(document.getElementById("root")!).render(<App />);
