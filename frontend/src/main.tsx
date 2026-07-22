// Frontend entrypoint: mounts the React app into the DOM.
// Single responsibility: bootstrap only, no UI logic.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// TODO: ReactDOM.createRoot(document.getElementById("root")!).render(
//   <React.StrictMode><App /></React.StrictMode>
// );
