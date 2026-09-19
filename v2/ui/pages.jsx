import React from "react";
import { createRoot } from "react-dom/client";
import Platform from "./Platform.jsx";
import { browserApi } from "../src/browser/api.ts";
const transport = (path, options) => browserApi.request(path, options);
async function reset() {
  await browserApi.request("/api/demo/reset", { method: "POST" });
  location.reload();
}
createRoot(document.getElementById("root")).render(
  <div className="browser-shell">
    <div className="browser-banner" role="note">
      <div>
        <strong>Browser Simulation</strong>
        <span>
          Mock prices · Data saved only in this browser · No server login or
          real trades
        </span>
      </div>
      <button onClick={reset}>Reset browser demo</button>
    </div>
    <Platform transport={transport} browserSimulation />
  </div>
);
