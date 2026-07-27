import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Pi Router console root is missing.");
}

createRoot(root).render(<App />);
